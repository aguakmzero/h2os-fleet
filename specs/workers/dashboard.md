# Dashboard Worker Spec

## Purpose

Web UI for monitoring and managing the H2OS device fleet.

## Route

```
GET /dashboard → dashboard-worker
```

## Behavior

Returns a single-page application (HTML + inline CSS + JS).

## UI Components

### Header

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 🌊 H2OS Fleet                                              ● 11 ● 1 ● 2 │
│ Groundwater Monitoring  v{version}                                      │
├─────────────────────────────────────────────────────────────────────────┤
│ [Search...]  │ STATUS          │ LOCATION     │ SORT            │ AUTO │
│              │ All(14) H(11)   │ [Dropdown]   │ Status Name Loc │ Off  │
│              │ P(1) O(2)       │              │ LastSeen        │      │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Logo**: H2OS Fleet branding
- **Version**: Git short hash
- **Summary badges**: Green/amber/red counts (top right)
- **Search**: Filter by device name, ID, location
- **Status pills**: All, Healthy, Partial, Offline (with counts)
- **Location dropdown**: Filter by location
- **Sort pills**: Status, Name, Location, Last Seen
- **Auto dropdown**: Off, 30s, 1m, 5m
- **Refresh button**: Manual refresh with timestamp
- **Dividers**: Vertical lines between control sections

### Device Cards

```
┌─────────────────────────────────────────┐
│ Device Name              📌   ● ONLINE  │
│ genie-52                                │
│ ○ Location Name                         │
│                                         │
│ SERVICES                    ████░ 5/6   │
│ ● groundwater-connection  ● kmzero      │
│ ● groundwater-genie-man.. ● groundwater │
│ ● groundwater-updater     ● main        │
│ Uptime: 17d 5h                          │
│                                         │
│            👁 📷 🔄 >_ 🖥               │
│ Last: 1h ago         genie-52-fleet...  │
└─────────────────────────────────────────┘
```

- **Title row**: Name, pin button, status badge
- **Subtitle**: Device ID (genie-XX)
- **Location tag**: Location with icon
- **Services section**: Progress bar + grid of service status
- **Uptime**: Time since boot
- **Buttons**: Details, Screenshot, Refresh, SSH, VNC (all icon-only, right-aligned)
- **Footer**: Last seen time, hostname

### Card Grid

- Responsive: `repeat(auto-fill, minmax(320px, 1fr))`
- Width matches header controls
- Pinned devices at top with divider

### Mobile

- Bottom navigation: Filter, Location, Sort, Refresh, Settings
- Sheet overlays for options
- Hidden desktop controls

## State Management

Client-side JavaScript state:

```javascript
let devices = [];           // All devices from API
let deviceStatuses = {};    // Status per device (healthy/partial/offline)
let deviceServicesHTML = {}; // Cached services HTML for re-render
let userPrefs = {
  pinnedDevices: [],
  sortBy: 'status',
  sortOrder: 'asc',
  autoRefreshInterval: 0,
  collapsedLocations: []
};
let searchTerm = '';
let statusFilter = 'all';
let locationFilter = 'all';
```

## API Calls

1. **On load**:
   - `GET /api/preferences` - Load user settings
   - `GET /api/devices` - Load device list

2. **Status check**:
   - `GET https://{device}-fleet.aguakmze.ro/status` - Per device

3. **Preferences**:
   - `POST /api/preferences` - Save on change (debounced)

## Features

- **Pinning**: Pin devices to top, persisted per user
- **Filtering**: By status, location, search term
- **Sorting**: By status, name, location, last seen
- **Auto-refresh**: Configurable interval
- **Status caching**: Preserved on filter/sort re-render
- **Offline alerts**: Browser notifications, tab title
- **Screenshots**: Modal viewer with refresh
- **VNC**: Opens in new tab
- **SSH**: Copy command to clipboard

## Responsive Breakpoints

- **Desktop** (>1100px): All controls visible
- **Medium** (769-1100px): Pills collapse to dropdowns, hide labels/dividers
- **Mobile** (<769px): Bottom nav, sheet overlays

## Size Target

~2000 lines (HTML + CSS + JS in one response)
