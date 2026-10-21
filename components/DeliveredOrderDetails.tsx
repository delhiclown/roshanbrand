import { ChangeEvent, useEffect, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  CreditCard,
  Eye,
  EyeOff,
  FileImage,
  KeyRound,
  Package,
  ShieldCheck,
  Ticket,
  UserRound,
} from 'lucide-react';
import { CustomerGuaranteeClaim, OrderRecord } from '../src/types';
import './DeliveredOrderDetails.css';

interface DeliveredOrderDetailsProps {
  order: OrderRecord;
  accessToken: string;
  guaranteeClaims: CustomerGuaranteeClaim[];
  copiedKey: string | null;
  onCopy: (text: string, key: string) => void;
  onDownload: (order: OrderRecord) => void;
  onGuaranteeClaimsUpdated: (claims: CustomerGuaranteeClaim[]) => void;
  onBack: () => void;
}

interface ParsedCredential {
  username: string;
  password: string;
  notes: string[];
  raw: string;
}

function parseCredential(line: string): ParsedCredential {
  const fields = line.split('|').map((field) => field.trim());
  const username = fields.find((field) => /^username\s*:/i.test(field));
  const password = fields.find((field) => /^password\s*:/i.test(field));

  return {
    username: username?.replace(/^username\s*:/i, '').trim() || 'See delivered credentials',
    password: password?.replace(/^password\s*:/i, '').trim() || '',
    notes: fields.filter((field) => field !== username && field !== password),
    raw: line,
  };
}

function getRentalExpiry(order: OrderRecord): Date | null {
  if (!order.isRental24h) return null;
  const savedExpiry = order.rentalExpiresAt ? new Date(order.rentalExpiresAt) : null;
  if (savedExpiry && Number.isFinite(savedExpiry.getTime())) return savedExpiry;
  const deliveredAt = new Date(order.verifiedAt || order.createdAt);
  return Number.isFinite(deliveredAt.getTime())
    ? new Date(deliveredAt.getTime() + 24 * 60 * 60 * 1000)
    : null;
}

function getOriginalGuaranteeExpiry(order: OrderRecord): Date | null {
  if (order.packType === 'guarantee_7days') {
    return new Date(
      new Date(order.verifiedAt || order.createdAt).getTime() + 7 * 24 * 60 * 60 * 1000
    );
  }
  if (order.packType !== 'guarantee_1month') return null;
  const expiry = new Date(order.verifiedAt || order.createdAt);
  if (!Number.isFinite(expiry.getTime())) return null;
  const targetMonth = expiry.getUTCMonth() + 1;
  const lastDay = new Date(
    Date.UTC(expiry.getUTCFullYear(), targetMonth + 1, 0)
  ).getUTCDate();
  expiry.setUTCDate(Math.min(expiry.getUTCDate(), lastDay));
  expiry.setUTCMonth(targetMonth);
  return expiry;
}

export function DeliveredOrderDetails({
  order,
  accessToken,
  guaranteeClaims,
  copiedKey,
  onCopy,
  onDownload,
  onGuaranteeClaimsUpdated,
  onBack,
}: DeliveredOrderDetailsProps) {
  const [visiblePasswords, setVisiblePasswords] = useState<Record<number, boolean>>({});
  const [claimingCredentialIndex, setClaimingCredentialIndex] = useState<number | null>(null);
  const [issueDescription, setIssueDescription] = useState('');
  const [screenshotDataUrl, setScreenshotDataUrl] = useState('');
  const [claimSubmitting, setClaimSubmitting] = useState(false);
  const [claimError, setClaimError] = useState('');
  const [claimSuccess, setClaimSuccess] = useState('');
  const [, setRentalExpiryTick] = useState(0);
  const rentalExpiry = getRentalExpiry(order);
  const isRentalExpired = Boolean(
    order.credentialsExpired ||
    (rentalExpiry && Number.isFinite(rentalExpiry.getTime()) && rentalExpiry.getTime() <= Date.now())
  );
  const accounts = (order.deliveredCredentials || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCredential)
    .filter(() => !isRentalExpired);
  const isDelivered = order.status === 'verified_delivered';
  const deliveredAt = order.verifiedAt || order.updatedAt || order.createdAt;
  const hasGuarantee =
    order.packType === 'guarantee_7days' || order.packType === 'guarantee_1month';
  const guaranteeExpiry = getOriginalGuaranteeExpiry(order);
  const guaranteeDaysLeft = guaranteeExpiry
    ? Math.max(0, Math.ceil((guaranteeExpiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
    : 0;
  const guaranteeOpenClaim = guaranteeClaims.find(
    (claim) => claim.status === 'pending' || claim.status === 'approved'
  );
  useEffect(() => {
    if (!rentalExpiry || isRentalExpired) return;
    const delay = rentalExpiry.getTime() - Date.now();
    if (delay <= 0) {
      setRentalExpiryTick((tick) => tick + 1);
      return;
    }
    const timer = window.setTimeout(() => setRentalExpiryTick((tick) => tick + 1), delay);
    return () => window.clearTimeout(timer);
  }, [rentalExpiry?.getTime(), isRentalExpired]);
  const formatDate = (value: string) =>
    new Date(value).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const handleScreenshotChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setClaimError('');
    setScreenshotDataUrl('');
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setClaimError('Choose a PNG, JPEG, or WebP screenshot.');
      event.target.value = '';
      return;
    }
    if (file.size > 1024 * 1024) {
      setClaimError('Screenshot must be no larger than 1 MB.');
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setScreenshotDataUrl(reader.result);
    };
    reader.onerror = () => setClaimError('The screenshot could not be read. Please try again.');
    reader.readAsDataURL(file);
  };

  const submitGuaranteeClaim = async () => {
    if (claimingCredentialIndex === null || !issueDescription.trim() || !accessToken) return;
    setClaimSubmitting(true);
    setClaimError('');
    setClaimSuccess('');
    try {
      const response = await fetch('/api/orders/guarantee-claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.orderId,
          accessToken,
          credentialIndex: claimingCredentialIndex,
          issueDescription: issueDescription.trim(),
          screenshotDataUrl: screenshotDataUrl || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not submit your guarantee claim.');
      onGuaranteeClaimsUpdated(data.guaranteeClaims || []);
      setClaimSuccess('Claim submitted. You can follow its status here.');
      setClaimingCredentialIndex(null);
      setIssueDescription('');
      setScreenshotDataUrl('');
    } catch (error) {
      setClaimError(error instanceof Error ? error.message : 'Could not submit your claim.');
    } finally {
      setClaimSubmitting(false);
    }
  };

  return (
    <section className="delivered-order-page" aria-labelledby="delivered-order-title">
      <header className="delivered-order-heading">
        <div className="delivered-order-heading-icon"><Ticket /></div>
        <div>
          <h1 id="delivered-order-title">Order Details</h1>
          <p>View your order information and delivery status</p>
        </div>
        <button type="button" className="delivered-back-button" onClick={onBack}>
          <ArrowLeft /><span>Back to store</span>
        </button>
      </header>

      <div className="delivered-order-titlebar">
        <div className="delivered-order-product-icon"><Ticket /></div>
        <div className="delivered-order-product-copy">
          <h2>{order.packLabel}</h2>
          <div className="delivered-order-badges">
            <span>
              {order.isRental24h
                ? '24H Rental'
                : order.packType === 'guarantee_7days'
                ? '7 Days Guarantee'
                : order.packType === 'guarantee_1month'
                ? '1 Month Guarantee'
                : 'IRCTC Account'}
            </span>
            <span className="delivered-badge-soft"><ShieldCheck /> UPI Verified</span>
            {order.refundedAt && <span className="delivered-badge-status is-pending">Refunded</span>}
            <span className={`delivered-badge-status${isDelivered ? '' : ' is-pending'}`}>
              {isDelivered ? <CheckCircle2 /> : <Clock3 />}
              {isDelivered ? 'Delivered' : 'Delivery pending'}
            </span>
          </div>
        </div>
        <span className="delivered-order-number">Order #{order.orderId}</span>
      </div>

      <div className="delivered-order-columns">
        <div className="delivered-order-main-column">
          <section className="delivered-section-card">
            <div className="delivered-section-heading">
              <span className="delivered-section-icon"><Package /></span>
              <h2>Order Overview</h2>
              <span className="delivered-section-date"><Clock3 /> {formatDate(order.createdAt)}</span>
            </div>
            <div className="delivered-overview-grid">
              <div className="delivered-overview-item">
                <span className="delivered-overview-icon"><Ticket /></span>
                <span><small>Package</small><strong>{order.packLabel}</strong></span>
              </div>
              <div className="delivered-overview-item">
                <span className="delivered-overview-icon"><UserRound /></span>
                <span><small>Quantity</small><strong>{order.quantity} IRCTC ID{order.quantity > 1 ? 's' : ''}</strong></span>
              </div>
              <div className="delivered-overview-item">
                <span className="delivered-overview-icon"><ShieldCheck /></span>
                <span><small>Payment status</small><strong className={order.refundedAt ? 'delivered-waiting' : 'delivered-positive'}>{order.refundedAt ? 'Refunded' : 'Verified'} · UTR {order.utrNumber}</strong></span>
              </div>
              <div className="delivered-overview-item">
                <span className="delivered-overview-icon"><Activity /></span>
                <span><small>Delivery status</small><strong className={isDelivered && !isRentalExpired ? 'delivered-positive' : 'delivered-waiting'}>{isRentalExpired ? 'Rental expired' : isDelivered ? 'Credentials delivered' : 'Awaiting delivery'}</strong></span>
              </div>
            </div>
          </section>

          <section className="delivered-section-card delivered-credentials-card">
            <div className="delivered-section-heading">
              <span className="delivered-section-icon"><KeyRound /></span>
              <div><h2>Delivery Details</h2><p>Your credentials to access your IRCTC account</p></div>
            </div>
            {isRentalExpired ? (
              <div className="delivered-claim-status is-resolved" role="status">
                <strong>24-hour rental expired</strong>
                <span>The panel no longer displays or provides access to these credentials. Expiry here does not disable the account in IRCTC.</span>
                {rentalExpiry && <span>Expired {formatDate(rentalExpiry.toISOString())}</span>}
              </div>
            ) : isDelivered ? (
              <div className="delivered-account-list">
                {accounts.map((account, index) => {
                  const passwordKey = `delivered-password-${index}`;
                  const copyKey = `delivered-account-${index}`;
                  return (
                    <article className="delivered-account-card" key={`${order.orderId}-${index}`}>
                      <div className="delivered-account-heading">
                        <span className="delivered-account-number"><UserRound /> Account {index + 1}</span>
                        <button type="button" className="delivered-copy-button" onClick={() => onCopy(account.raw, copyKey)}>
                          {copiedKey === copyKey ? <Check /> : <Copy />}
                          {copiedKey === copyKey ? 'Copied' : 'Copy details'}
                        </button>
                      </div>
                      <div className="delivered-credential-fields">
                        <div className="delivered-credential-field">
                          <span><UserRound /> Username</span>
                          <div><code>{account.username}</code><button type="button" aria-label={`Copy username for account ${index + 1}`} onClick={() => onCopy(account.username, `delivered-username-${index}`)}>{copiedKey === `delivered-username-${index}` ? <Check /> : <Copy />}</button></div>
                        </div>
                        {account.password && (
                          <div className="delivered-credential-field">
                            <span><KeyRound /> Password</span>
                            <div>
                              <code>{visiblePasswords[index] ? account.password : '•'.repeat(Math.min(account.password.length, 16))}</code>
                              <button type="button" aria-label={visiblePasswords[index] ? 'Hide password' : 'Show password'} onClick={() => setVisiblePasswords((current) => ({ ...current, [index]: !current[index] }))}>{visiblePasswords[index] ? <EyeOff /> : <Eye />}</button>
                              <button type="button" aria-label={`Copy password for account ${index + 1}`} onClick={() => onCopy(account.password, `delivered-password-copy-${index}`)}>{copiedKey === `delivered-password-copy-${index}` ? <Check /> : <Copy />}</button>
                            </div>
                          </div>
                        )}
                      </div>
                      {account.notes.length > 0 && (
                        <p className="delivered-account-notes">{account.notes.join(' · ')}</p>
                      )}
                      {hasGuarantee && guaranteeExpiry && (
                        <div className="delivered-guarantee-box">
                          <div className="delivered-guarantee-meta">
                            <ShieldCheck />
                            <span>
                              <strong>
                                {order.packType === 'guarantee_7days' ? '7-day' : '1-month'} guarantee
                                {guaranteeDaysLeft > 0
                                  ? ` · ${guaranteeDaysLeft} day${guaranteeDaysLeft === 1 ? '' : 's'} left`
                                  : ' · Expired'}
                              </strong>
                              <small>Guarantee valid till: {formatDate(guaranteeExpiry.toISOString())}</small>
                            </span>
                          </div>
                          {guaranteeClaims
                            .filter((claim) => claim.credentialIndex === index)
                            .map((claim) => (
                              <div key={claim.claimId} className={`delivered-claim-status is-${claim.status}`}>
                                <strong>Claim {claim.status}</strong>
                                <span>#{claim.claimId} · {formatDate(claim.createdAt)}</span>
                                {claim.rejectionReason && <p>Reason: {claim.rejectionReason}</p>}
                                {claim.resolution === 'refund' && <p>Refund marked for this order.</p>}
                                {claim.resolution === 'replacement' && (
                                  <p>Replacement delivered · guarantee remains valid till {formatDate(claim.expiresAt)}.</p>
                                )}
                              </div>
                            ))}
                          {guaranteeDaysLeft > 0 && (
                            <button
                              type="button"
                              disabled={
                                !accessToken ||
                                Boolean(guaranteeOpenClaim) ||
                                Boolean(order.refundedAt)
                              }
                              onClick={() => {
                                setClaimError('');
                                setClaimSuccess('');
                                setIssueDescription('');
                                setScreenshotDataUrl('');
                                setClaimingCredentialIndex(index);
                              }}
                              className="delivered-claim-button"
                            >
                              {guaranteeOpenClaim
                                ? 'Claim already in progress'
                                : 'Claim Guarantee'}
                            </button>
                          )}
                          {claimingCredentialIndex === index && (
                            <div className="delivered-claim-form">
                              <label>
                                <span>Describe the issue <strong>*</strong></span>
                                <textarea
                                  required
                                  maxLength={2000}
                                  rows={4}
                                  value={issueDescription}
                                  onChange={(event) => setIssueDescription(event.target.value)}
                                  placeholder="Tell us what happened to this ID"
                                />
                              </label>
                              <label className="delivered-claim-upload">
                                <FileImage />
                                <span>
                                  Screenshot (optional)
                                  <small>PNG, JPEG, or WebP · up to 1 MB</small>
                                </span>
                                <input
                                  type="file"
                                  accept="image/png,image/jpeg,image/webp"
                                  onChange={handleScreenshotChange}
                                />
                              </label>
                              {screenshotDataUrl && <p className="delivered-claim-file">Screenshot attached</p>}
                              {claimError && <p className="delivered-claim-error" role="alert">{claimError}</p>}
                              <div className="delivered-claim-actions">
                                <button
                                  type="button"
                                  onClick={() => setClaimingCredentialIndex(null)}
                                  disabled={claimSubmitting}
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={submitGuaranteeClaim}
                                  disabled={claimSubmitting || !issueDescription.trim()}
                                >
                                  {claimSubmitting ? 'Submitting…' : 'Submit claim'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
                {claimSuccess && <p className="delivered-claim-success" role="status">{claimSuccess}</p>}
                {!isRentalExpired && <div className="delivered-credentials-actions">
                  <button type="button" onClick={() => onCopy(order.deliveredCredentials, 'delivered-all')}>
                    {copiedKey === 'delivered-all' ? <Check /> : <Copy />}
                    {copiedKey === 'delivered-all' ? 'Copied all credentials' : 'Copy all credentials'}
                  </button>
                  <button type="button" onClick={() => onDownload(order)}><ArrowDownToLine /> Download CSV</button>
                </div>}
              </div>
            ) : (
              <div className="delivered-pending-message">
                <Clock3 />
                <div><strong>Payment received — delivery in progress</strong><p>Your account details will appear here automatically once the order is delivered.</p></div>
              </div>
            )}
          </section>

          <section className="delivered-section-card delivered-activity-card">
            <div className="delivered-section-heading">
              <span className="delivered-section-icon"><Activity /></span>
              <h2>Recent Activity</h2>
            </div>
            <div className="delivered-activity-row">
              <span className="delivered-activity-icon">{isDelivered ? <CheckCircle2 /> : <Clock3 />}</span>
              <span><strong>{isDelivered ? 'Order delivered' : 'Order submitted'}</strong><small>{formatDate(deliveredAt)}</small></span>
              <span className={`delivered-activity-status${isDelivered ? '' : ' is-pending'}`}>{isDelivered ? 'Complete' : 'Pending'}</span>
            </div>
          </section>
        </div>

        <aside className="delivered-order-side-column">
          <section className="delivered-section-card delivered-status-card">
            <div className="delivered-section-heading">
              <span className="delivered-section-icon"><Activity /></span><h2>Delivery Status</h2>
            </div>
            <p className="delivered-status-description">Track payment verification and account delivery for your order.</p>
            <div className={`delivered-status-summary${isDelivered ? '' : ' is-pending'}`}>
              <span className="delivered-status-led" />
              <span><strong>{isRentalExpired ? 'Rental Expired' : isDelivered ? 'Order Delivered' : 'Processing Order'}</strong><small>{isRentalExpired ? 'Credentials are no longer available in this panel' : isDelivered ? 'Your credentials are ready to use' : 'Your order is being verified'}</small></span>
            </div>
            <div className="delivered-status-info"><span>Order ID</span><strong>{order.orderId}</strong></div>
            <div className="delivered-status-info"><span>Payment</span><strong>{isDelivered ? 'Verified' : 'Submitted'}</strong></div>
          </section>

          <section className="delivered-section-card delivered-billing-card">
            <div className="delivered-section-heading">
              <span className="delivered-section-icon"><CreditCard /></span><h2>Billing Information</h2>
            </div>
            <div className="delivered-billing-summary">
              <span className="delivered-billing-icon"><CalendarDays /></span>
              <span><small>{order.isRental24h ? 'Rental expires' : 'Order placed'}</small><strong>{order.isRental24h && order.rentalExpiresAt ? formatDate(order.rentalExpiresAt) : formatDate(order.createdAt)}</strong></span>
            </div>
            <dl className="delivered-billing-details">
              <div><dt>Subtotal</dt><dd>₹{order.totalAmount.toLocaleString('en-IN')}</dd></div>
              <div><dt>Quantity</dt><dd>{order.quantity} ID{order.quantity > 1 ? 's' : ''}</dd></div>
              <div><dt>Payment method</dt><dd>UPI</dd></div>
              <div><dt>UTR reference</dt><dd>{order.utrNumber}</dd></div>
              <div className="delivered-billing-total"><dt>Total paid</dt><dd>₹{order.totalAmount.toLocaleString('en-IN')}</dd></div>
            </dl>
            {!isRentalExpired && (
              <button type="button" className="delivered-invoice-button" onClick={() => onDownload(order)}>
                <ArrowDownToLine /> Download order CSV
              </button>
            )}
          </section>

          <section className="delivered-help-card">
            <span><ShieldCheck /></span>
            <div><strong>Keep your credentials safe</strong><p>Never share your password or transaction details with anyone.</p></div>
          </section>
        </aside>
      </div>
    </section>
  );
}
