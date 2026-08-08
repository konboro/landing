export interface NavItem {
  to: string;
  label: string;
  icon: string;
  group: string;
  badgeKey?: 'verification';
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: '📊', group: 'Operate' },
  { to: '/verification', label: 'Ride verification', icon: '📷', group: 'Operate', badgeKey: 'verification' },
  { to: '/rides', label: 'Rides', icon: '🛴', group: 'Operate' },
  { to: '/vehicles', label: 'Vehicles', icon: '🔋', group: 'Operate' },
  { to: '/customers', label: 'Customers', icon: '👤', group: 'Operate' },

  { to: '/analytics', label: 'Analytics', icon: '📈', group: 'Insight' },

  { to: '/zones', label: 'Zones', icon: '🗺️', group: 'Configure' },
  { to: '/pricing', label: 'Pricing', icon: '💶', group: 'Configure' },
  { to: '/marketing', label: 'Marketing', icon: '📣', group: 'Configure' },

  { to: '/fleet', label: 'Fleet maintenance', icon: '🔧', group: 'Fleet' },
  { to: '/connectivity', label: 'Connectivity', icon: '📶', group: 'Fleet' },

  { to: '/finance', label: 'Finance', icon: '🧾', group: 'Money' },

  { to: '/content', label: 'Subscriptions & Add-ons', icon: '🎫', group: 'Content' },

  { to: '/team', label: 'Team & accounts', icon: '🛡️', group: 'Admin' },
  { to: '/settings', label: 'Settings', icon: '⚙️', group: 'Admin' },
];

export const NAV_GROUPS = ['Operate', 'Insight', 'Configure', 'Fleet', 'Money', 'Content', 'Admin'];
