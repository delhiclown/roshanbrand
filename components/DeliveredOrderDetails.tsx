import { useState } from 'react';
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
  KeyRound,
  Package,
  ShieldCheck,
  Ticket,
  UserRound,
} from 'lucide-react';
import { OrderRecord } from '../src/types';
import './DeliveredOrderDetails.css';

interface DeliveredOrderDetailsProps {
  order: OrderRecord;
  copiedKey: string | null;
  onCopy: (text: string, key: string) => void;
  onDownload: (order: OrderRecord) => void;
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

export function DeliveredOrderDetails({
  order,
  copiedKey,
  onCopy,
  onDownload,
  onBack,
}: DeliveredOrderDetailsProps) {
  const [visiblePasswords, setVisiblePasswords] = useState<Record<number, boolean>>({});
  const accounts = (order.deliveredCredentials || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCredential);
  const isDelivered = order.status === 'verified_delivered' && accounts.length > 0;
  const deliveredAt = order.verifiedAt || order.updatedAt || order.createdAt;
  const formatDate = (value: string) =>
    new Date(value).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

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
                <span><small>Payment status</small><strong className="delivered-positive">Verified · UTR {order.utrNumber}</strong></span>
              </div>
              <div className="delivered-overview-item">
                <span className="delivered-overview-icon"><Activity /></span>
                <span><small>Delivery status</small><strong className={isDelivered ? 'delivered-positive' : 'delivered-waiting'}>{isDelivered ? 'Credentials delivered' : 'Awaiting delivery'}</strong></span>
              </div>
            </div>
          </section>

          <section className="delivered-section-card delivered-credentials-card">
            <div className="delivered-section-heading">
              <span className="delivered-section-icon"><KeyRound /></span>
              <div><h2>Delivery Details</h2><p>Your credentials to access your IRCTC account</p></div>
            </div>
            {isDelivered ? (
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
                    </article>
                  );
                })}
                <div className="delivered-credentials-actions">
                  <button type="button" onClick={() => onCopy(order.deliveredCredentials, 'delivered-all')}>
                    {copiedKey === 'delivered-all' ? <Check /> : <Copy />}
                    {copiedKey === 'delivered-all' ? 'Copied all credentials' : 'Copy all credentials'}
                  </button>
                  <button type="button" onClick={() => onDownload(order)}><ArrowDownToLine /> Download CSV</button>
                </div>
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
              <span><strong>{isDelivered ? 'Order Delivered' : 'Processing Order'}</strong><small>{isDelivered ? 'Your credentials are ready to use' : 'Your order is being verified'}</small></span>
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
            <button type="button" className="delivered-invoice-button" onClick={() => onDownload(order)}>
              <ArrowDownToLine /> Download order CSV
            </button>
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
