// Tiny inline icons (stroke = currentColor).
const base = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const IconSoundOn = () => (
  <svg {...base}>
    <path d="M4 9v6h4l5 4V5L8 9H4z" />
    <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
  </svg>
);
export const IconSoundOff = () => (
  <svg {...base}>
    <path d="M4 9v6h4l5 4V5L8 9H4z" />
    <path d="M17 9.5l5 5M22 9.5l-5 5" />
  </svg>
);
export const IconArchive = () => (
  <svg {...base}>
    <rect x="3" y="4" width="18" height="5" rx="1" />
    <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" />
  </svg>
);
export const IconDownload = () => (
  <svg {...base}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </svg>
);
export const IconReplay = () => (
  <svg {...base}>
    <path d="M4 12a8 8 0 1 0 2.3-5.6L4 8.7" />
    <path d="M4 4v4.7h4.7" />
  </svg>
);
export const IconPlus = () => (
  <svg {...base}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const IconClose = () => (
  <svg {...base}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const IconTrash = () => (
  <svg {...base}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  </svg>
);
export const IconSkip = () => (
  <svg {...base}>
    <path d="M5 5l9 7-9 7V5zM18 5v14" />
  </svg>
);
export const IconHeart = () => (
  <svg {...base}>
    <path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" />
  </svg>
);
