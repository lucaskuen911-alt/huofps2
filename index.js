// MAP REGISTRY. Menu order and the default map. Each entry is a map data asset.

import { SALTWORKS } from './saltworks.js';
import { DOCKSIDE9 } from './dockside9.js';

export const MAPS = {
  dockside9: DOCKSIDE9,
  saltworks: SALTWORKS,
};

export const MAP_ORDER = ['dockside9', 'saltworks'];
export const DEFAULT_MAP = 'dockside9';
