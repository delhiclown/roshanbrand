import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Cloud,
  CreditCard,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  MoreHorizontal,
  Package,
  Plus,
  Server,
  Settings,
  ShoppingCart,
  Sparkles,
  Sun,
  Ticket,
  TrendingUp,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import './Dashboard.css';

type DashboardPage =
  | 'Dashboard'
  | 'All Plans'
  | 'Linux Servers'
  | 'Windows VPS'
  | 'Premium IP Proxies'
  | 'Trial VPS'
  | 'My Services'
  | 'Orders'
  | 'Invoices'
  | 'Support Tickets'
  | 'Cart';

const planItems: { label: DashboardPage; icon: typeof Server }[] = [
  { label: 'All Plans', icon: Package },
  { label: 'Linux Servers', icon: Server },
  { label: 'Windows VPS', icon: Cloud },
  { label: 'Premium IP Proxies', icon: Zap },
  { label: 'Trial VPS', icon: Sparkles },
];

const manageItems: { label: DashboardPage; icon: typeof Server }[] = [
  { label: 'My Services', icon: Activity },
  { label: 'Orders', icon: Package },
  { label: 'Invoices', icon: CreditCard },
  { label: 'Support Tickets', icon: Ticket },
];

const pageDescription: Record<DashboardPage, string> = {
  Dashboard: 'Overview of your account and services',
  'All Plans': 'Explore VPS plans built for your projects',
  'Linux Servers': 'Manage your Linux virtual servers',
  'Windows VPS': 'Manage your Windows virtual servers',
  'Premium IP Proxies': 'Manage your premium IP proxies',
  'Trial VPS': 'Explore available VPS trials',
  'My Services': 'Manage your active and pending services',
  Orders: 'View your order history',
  Invoices: 'View and manage your invoices',
  'Support Tickets': 'Get help from our support team',
  Cart: 'Review items in your cart',
};

const chartLinePath = 'M 0 172 H 435 C 500 172 525 10 580 10 C 635 10 687 111 720 152';
const chartAreaPath = `${chartLinePath} L 720 172 Z`;

export function Dashboard() {
  const [activePage, setActivePage] = useState<DashboardPage>('Dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [lightMode, setLightMode] = useState(false);
  const [openPopover, setOpenPopover] = useState<'wallet' | 'notifications' | 'profile' | null>(
    null
  );
  const [notice, setNotice] = useState('');
  const [plansExpanded, setPlansExpanded] = useState(true);
  const [manageExpanded, setManageExpanded] = useState(true);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'SkyVPS - Dashboard';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  const goTo = (page: DashboardPage) => {
    setActivePage(page);
    setSidebarOpen(false);
    setOpenPopover(null);
    setNotice('');
  };

  const showNotice = (message: string) => {
    setNotice(message);
    setOpenPopover(null);
  };

  const togglePopover = (popover: 'wallet' | 'notifications' | 'profile') => {
    setOpenPopover((current) => (current === popover ? null : popover));
  };

  return (
    <div className={`skyvps-dashboard${lightMode ? ' skyvps-dashboard--light' : ''}`}>
      {sidebarOpen && (
        <button
          type="button"
          className="skyvps-mobile-backdrop"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={`skyvps-sidebar${sidebarOpen ? ' skyvps-sidebar--open' : ''}`}>
        <button
          className="skyvps-brand-card"
          type="button"
          aria-label="SkyVPS dashboard"
          onClick={() => goTo('Dashboard')}
        >
          <span className="skyvps-brand-icon"><Cloud /></span>
          <span className="skyvps-brand-copy">
            <strong>SkyVPS</strong>
            <span><i /> A PRODUCT OF <b>✦</b> Backtick Labs</span>
          </span>
        </button>

        <nav className="skyvps-side-scroll" aria-label="Main navigation">
          <section className="skyvps-nav-section">
            <div className="skyvps-nav-heading">Overview</div>
            <button
              type="button"
              className={`skyvps-nav-link${activePage === 'Dashboard' ? ' is-active' : ''}`}
              onClick={() => goTo('Dashboard')}
            >
              <LayoutDashboard /> <span>Dashboard</span>
            </button>
          </section>

          <section className="skyvps-nav-section">
            <button
              type="button"
              className="skyvps-nav-heading skyvps-nav-toggle"
              aria-expanded={plansExpanded}
              onClick={() => setPlansExpanded((expanded) => !expanded)}
            >
              <span>Buy plans</span><ChevronDown className={plansExpanded ? '' : 'is-collapsed'} />
            </button>
            {plansExpanded && (
              <div className="skyvps-nav-list">
                {planItems.map(({ label, icon: Icon }) => (
                  <button
                    type="button"
                    key={label}
                    className={`skyvps-nav-link${activePage === label ? ' is-active' : ''}`}
                    onClick={() => goTo(label)}
                  >
                    <Icon /><span>{label}</span>
                    {label === 'All Plans' && <span className="skyvps-shop-pill">Shop</span>}
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="skyvps-nav-section">
            <button
              type="button"
              className="skyvps-nav-heading skyvps-nav-toggle"
              aria-expanded={manageExpanded}
              onClick={() => setManageExpanded((expanded) => !expanded)}
            >
              <span>Manage</span><ChevronDown className={manageExpanded ? '' : 'is-collapsed'} />
            </button>
            {manageExpanded && (
              <div className="skyvps-nav-list">
                {manageItems.map(({ label, icon: Icon }) => (
                  <button
                    type="button"
                    key={label}
                    className={`skyvps-nav-link${activePage === label ? ' is-active' : ''}`}
                    onClick={() => goTo(label)}
                  >
                    <Icon /><span>{label}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </nav>

        <div className="skyvps-sidebar-footer">
          <button
            type="button"
            className="skyvps-account-card"
            onClick={() => togglePopover('profile')}
          >
            <span className="skyvps-user-avatar">D<span /></span>
            <span className="skyvps-account-copy">
              <strong>delhiclown</strong>
              <span>delhiclown@gmail.com</span>
            </span>
            <MoreHorizontal />
          </button>
          <button
            type="button"
            className="skyvps-signout"
            onClick={() => showNotice('Sign out is not connected in this dashboard preview.')}
          >
            <LogOut /> <span>Sign Out</span>
          </button>
        </div>
      </aside>

      <div className="skyvps-workspace">
        <header className="skyvps-topbar">
          <button
            type="button"
            className="skyvps-icon-button skyvps-mobile-menu"
            aria-label="Open navigation"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu />
          </button>
          <div className="skyvps-page-title">
            <span className="skyvps-page-title-icon"><Home /></span>
            <span><strong>{activePage}</strong><small>{pageDescription[activePage]}</small></span>
          </div>

          <div className="skyvps-top-actions">
            <div className="skyvps-popover-wrap">
              <button className="skyvps-wallet" type="button" onClick={() => togglePopover('wallet')}>
                <span className="skyvps-status-dot" /><Wallet /><strong>₹0</strong>
              </button>
              {openPopover === 'wallet' && (
                <div className="skyvps-popover">
                  <strong>Wallet balance</strong><p>Your available balance is ₹0.</p>
                  <button type="button" onClick={() => showNotice('Wallet top-up will be available soon.')}>
                    Add funds <ArrowRight />
                  </button>
                </div>
              )}
            </div>
            <button
              type="button"
              className="skyvps-icon-button skyvps-add-button"
              aria-label="New order"
              onClick={() => goTo('All Plans')}
            ><Plus /></button>
            <button type="button" className="skyvps-icon-button" aria-label="Cart" onClick={() => goTo('Cart')}>
              <ShoppingCart />
            </button>
            <div className="skyvps-popover-wrap">
              <button
                type="button"
                className="skyvps-icon-button skyvps-bell-button"
                aria-label="Notifications"
                onClick={() => togglePopover('notifications')}
              ><Bell /><span className="skyvps-notification-count">51</span></button>
              {openPopover === 'notifications' && (
                <div className="skyvps-popover skyvps-notifications">
                  <strong>Notifications</strong>
                  <p><span className="skyvps-notification-indicator" />Your dashboard is up to date.</p>
                  <p><span className="skyvps-notification-indicator" />New service updates will appear here.</p>
                  <button type="button" onClick={() => showNotice('All notifications marked as read.')}>
                    Mark all as read <Check />
                  </button>
                </div>
              )}
            </div>
            <button
              type="button"
              className="skyvps-icon-button"
              aria-label={lightMode ? 'Switch to dark mode' : 'Switch to light mode'}
              onClick={() => setLightMode((mode) => !mode)}
            >{lightMode ? <Sun /> : <Moon />}</button>
            <div className="skyvps-popover-wrap">
              <button
                type="button"
                className="skyvps-top-avatar"
                aria-label="Account menu"
                onClick={() => togglePopover('profile')}
              >D<span /></button>
              {openPopover === 'profile' && (
                <div className="skyvps-popover skyvps-profile-popover">
                  <strong>delhiclown</strong><p>delhiclown@gmail.com</p>
                  <button type="button" onClick={() => goTo('Invoices')}><CreditCard /> Billing</button>
                  <button type="button" onClick={() => goTo('Support Tickets')}><Ticket /> Support</button>
                  <button type="button" onClick={() => showNotice('Sign out is not connected in this dashboard preview.')}><LogOut /> Sign Out</button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="skyvps-main">
          {activePage === 'Dashboard' ? (
            <>
              <section className="skyvps-welcome-card">
                <div className="skyvps-welcome-user">
                  <span className="skyvps-welcome-avatar">D</span>
                  <div>
                    <span className="skyvps-greeting">Good morning</span>
                    <h1>delhiclown</h1>
                    <p><strong>3 active services</strong><span className="skyvps-welcome-separator"> · </span><em>2 pending</em></p>
                    <span className="skyvps-date">
                      <CalendarDays />{' '}
                      {new Date().toLocaleDateString('en-GB', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                </div>
                <div className="skyvps-welcome-actions">
                  <button type="button" className="skyvps-action-button skyvps-action-primary" onClick={() => goTo('All Plans')}>
                    <Zap /> New Order
                  </button>
                  <button type="button" className="skyvps-action-button" onClick={() => goTo('Invoices')}>
                    <ArrowDownToLine /> Invoice
                  </button>
                  <button type="button" className="skyvps-action-button" onClick={() => showNotice('Account settings are not connected in this dashboard preview.')}>
                    <Settings /> Settings
                  </button>
                </div>
              </section>

              <section className="skyvps-stats-grid" aria-label="Account statistics">
                <article className="skyvps-stat-card">
                  <div className="skyvps-stat-heading"><span className="skyvps-stat-icon stat-orders"><Package /></span><span>Orders</span></div>
                  <strong>5</strong><small>All time</small>
                </article>
                <article className="skyvps-stat-card">
                  <div className="skyvps-stat-heading"><span className="skyvps-stat-icon stat-active"><Activity /></span><span>Active</span></div>
                  <strong>3 <span className="skyvps-live-pill"><i /> Live</span></strong><small>Running</small>
                </article>
                <article className="skyvps-stat-card">
                  <div className="skyvps-stat-heading"><span className="skyvps-stat-icon stat-spent"><TrendingUp /></span><span>Spent</span></div>
                  <strong>₹4,345</strong><small><span className="skyvps-change-pill">↘ 90%</span> vs last mo</small>
                </article>
                <article className="skyvps-stat-card">
                  <div className="skyvps-stat-heading"><span className="skyvps-stat-icon stat-pending"><Clock3 /></span><span>Pending</span></div>
                  <strong>2</strong><small>Awaiting setup</small>
                </article>
              </section>

              <section className="skyvps-analytics-grid" aria-label="Spending analytics">
                <article className="skyvps-panel skyvps-spending-panel">
                  <div className="skyvps-panel-heading">
                    <span className="skyvps-panel-icon stat-active"><TrendingUp /></span>
                    <div><h2>Spending Trend</h2><p>Last 6 months</p></div>
                    <span className="skyvps-change-pill skyvps-chart-change">-90%</span>
                  </div>
                  <div className="skyvps-chart">
                    <div className="skyvps-chart-ylabels"><span>₹3.6K</span><span>₹2.7K</span><span>₹1.8K</span><span>₹900</span><span>₹0</span></div>
                    <svg className="skyvps-chart-svg" viewBox="0 0 720 190" preserveAspectRatio="none" role="img" aria-label="Monthly spend from May to October">
                      <defs>
                        <linearGradient id="skyvps-area-fill" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0%" stopColor="#10c894" stopOpacity=".16" />
                          <stop offset="100%" stopColor="#10c894" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      <path
                        d="M 0 0 H 720 M 0 43 H 720 M 0 86 H 720 M 0 129 H 720 M 0 172 H 720 M 0 0 V 172 M 144 0 V 172 M 288 0 V 172 M 432 0 V 172 M 576 0 V 172 M 720 0 V 172"
                        className="skyvps-chart-grid"
                      />
                      <path d={chartAreaPath} className="skyvps-chart-area" />
                      <path d={chartLinePath} className="skyvps-chart-line" />
                      <circle cx="0" cy="172" r="3" className="skyvps-chart-dot" />
                      <circle cx="145" cy="172" r="3" className="skyvps-chart-dot" />
                      <circle cx="290" cy="172" r="3" className="skyvps-chart-dot" />
                      <circle cx="435" cy="172" r="3" className="skyvps-chart-dot" />
                      <circle cx="580" cy="10" r="3" className="skyvps-chart-dot" />
                      <circle cx="720" cy="152" r="3" className="skyvps-chart-dot" />
                    </svg>
                    <div className="skyvps-chart-xlabels"><span>May</span><span>Jun</span><span>Jul</span><span>Aug</span><span>Sep</span><span>Oct</span></div>
                  </div>
                </article>

                <article className="skyvps-panel skyvps-distribution-panel">
                  <div className="skyvps-panel-heading">
                    <span className="skyvps-panel-icon stat-pending"><Package /></span>
                    <div><h2>Distribution</h2><p>5 orders</p></div>
                  </div>
                  <div className="skyvps-donut-wrap">
                    <div className="skyvps-donut">
                      <div><strong>5</strong><span>Orders</span></div>
                    </div>
                  </div>
                  <div className="skyvps-legend">
                    <span><i className="legend-pending" /> Pending <b>2</b></span>
                    <span><i className="legend-other" /> Other <b>3</b></span>
                  </div>
                </article>
              </section>

              <section className="skyvps-lower-grid">
                <article className="skyvps-panel skyvps-recent-panel">
                  <div className="skyvps-panel-heading">
                    <span className="skyvps-panel-icon stat-orders"><Package /></span>
                    <div><h2>Recent Orders</h2><p>Your latest purchases</p></div>
                    <button type="button" className="skyvps-view-all" onClick={() => goTo('Orders')}>View all <ChevronRight /></button>
                  </div>
                  <div className="skyvps-order-row">
                    <span className="skyvps-order-product"><Server /></span>
                    <span className="skyvps-order-copy"><strong>Linux VPS — Standard</strong><small>Order #SV-20481 · 2 Oct 2026</small></span>
                    <span className="skyvps-order-status">Active</span>
                    <strong className="skyvps-order-price">₹2,499</strong>
                  </div>
                  <div className="skyvps-order-row">
                    <span className="skyvps-order-product"><Cloud /></span>
                    <span className="skyvps-order-copy"><strong>Windows VPS — Starter</strong><small>Order #SV-20472 · 28 Sep 2026</small></span>
                    <span className="skyvps-order-status status-pending">Pending</span>
                    <strong className="skyvps-order-price">₹1,846</strong>
                  </div>
                </article>
                <article className="skyvps-panel skyvps-account-panel">
                  <div className="skyvps-panel-heading">
                    <span className="skyvps-welcome-avatar skyvps-account-avatar">D</span>
                    <div><h2>Account</h2><p>Personal information</p></div>
                    <button type="button" className="skyvps-more-button" aria-label="Account options" onClick={() => togglePopover('profile')}><MoreHorizontal /></button>
                  </div>
                  <dl className="skyvps-account-details">
                    <div><dt>Name</dt><dd>delhiclown</dd></div>
                    <div><dt>Email</dt><dd>delhiclown@gmail.com</dd></div>
                    <div><dt>Member since</dt><dd>September 2026</dd></div>
                    <div><dt>Status</dt><dd className="account-active"><i /> Active</dd></div>
                  </dl>
                </article>
              </section>
            </>
          ) : (
            <section className="skyvps-empty-page">
              <div className="skyvps-empty-icon"><Package /></div>
              <h1>{activePage}</h1>
              <p>
                {activePage === 'Cart'
                  ? 'Your cart is empty.'
                  : activePage === 'Invoices'
                    ? 'Your invoices will appear here.'
                    : activePage === 'Support Tickets'
                      ? 'You have no open support tickets.'
                      : activePage === 'My Services'
                        ? 'Your VPS services will appear here.'
                        : activePage === 'Orders'
                          ? 'Your recent orders will appear here.'
                          : `Browse ${activePage.toLowerCase()} and choose a plan that fits your needs.`}
              </p>
              {['All Plans', 'Linux Servers', 'Windows VPS', 'Premium IP Proxies', 'Trial VPS'].includes(activePage) && (
                <div className="skyvps-plan-cards">
                  <div><Server /><strong>Starter</strong><span>2 vCPU · 4 GB RAM · 80 GB NVMe</span><b>From ₹499/mo</b><button type="button" onClick={() => showNotice('Plan details are ready to be connected to your VPS ordering API.')}>View plans <ArrowRight /></button></div>
                  <div><Zap /><strong>Performance</strong><span>4 vCPU · 8 GB RAM · 160 GB NVMe</span><b>From ₹999/mo</b><button type="button" onClick={() => showNotice('Plan details are ready to be connected to your VPS ordering API.')}>View plans <ArrowRight /></button></div>
                  <div><Sparkles /><strong>Business</strong><span>8 vCPU · 16 GB RAM · 320 GB NVMe</span><b>From ₹1,999/mo</b><button type="button" onClick={() => showNotice('Plan details are ready to be connected to your VPS ordering API.')}>View plans <ArrowRight /></button></div>
                </div>
              )}
              <button type="button" className="skyvps-back-button" onClick={() => goTo('Dashboard')}><ArrowLeft /> Back to dashboard</button>
            </section>
          )}
        </main>
      </div>

      {notice && (
        <div className="skyvps-toast" role="status">
          <span>{notice}</span>
          <button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}><X /></button>
        </div>
      )}
    </div>
  );
}
