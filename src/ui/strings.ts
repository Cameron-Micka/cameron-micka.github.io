export const SITE = {
  name: 'Cameron Micka',
  role: 'Principal Software Engineer',
  url: 'https://cameron-micka.github.io',
  tagline:
    'Engineer who loves bridging the gap between design and engineering.',
};

export const INTRO = {
  title: 'Design meets real-time engineering.',
  body: 'Games, mixed reality, and tools that give creative people superpowers.',
  explore: 'Explore the work',
};

export const NAV = {
  home: 'Timeline',
  about: 'About',
  blog: 'Blog',
  photography: 'Photos',
};

export const SOCIAL = {
  github: 'https://github.com/Cameron-Micka',
  linkedin: 'https://www.linkedin.com/in/tcmicka/',
  bluesky: 'https://bsky.app/profile/tcmicka.bsky.social',
  x: 'https://x.com/tcmicka',
};

export const HINTS = {
  scrubDesktop:
    'Scroll down for earlier work · drag to rotate · select a glowing point',
  scrubTouch: 'Use the arrows to travel · drag to rotate · tap a glowing point',
  freeCameraDesktop: [
    { action: 'WASD', detail: ' to fly' },
    { action: 'Drag empty space', detail: ' to look' },
    { action: 'Shift', detail: ' to boost' },
    { action: 'Space', detail: ' to creep' },
    { action: 'Drag a planet or sun', detail: ' to move it' },
  ],
  freeCameraTouch: {
    flyAction: 'Drag empty space',
    flyDetail: ' - left to fly, right to look',
    moveAction: 'Drag a planet or sun',
    moveDetail: ' to move it',
  },
};

export const UI = {
  loading: 'Entering the timeline…',
  errorTitle: "The timeline couldn't start.",
  errorBody:
    'The 3D view is unavailable, but the work is all here. Read the full story below, or try reloading.',
  reload: 'Reload',
  close: 'Close',
  expand: 'Expand',
  collapse: 'Collapse',
  poiList: 'Project stories',
  projectJump: 'Jump to a story',
  projects: (count: number) => `${count} ${count === 1 ? 'story' : 'stories'}`,
  earlier: 'Earlier chapter',
  later: 'More recent chapter',
  pause: 'Pause motion',
  resume: 'Resume motion',
  sound: 'Sound effects',
  skip: 'Skip to content',
  details: 'Technical details',
  settings: 'Settings',
  freeCamera: 'Free camera',
  blogSoon: 'Notes from the pixel mines.',
};

export const PHOTOGRAPHY = {
  title: 'Photography',
  lede: 'Frames from the road and the trail — shot for the love of light.',
  sections: {
    nature: 'Nature',
    automotive: 'Automotive',
  },
  empty: 'No photos here yet. Check back soon.',
  jumpLabel: 'Photography sections',
  gridLabel: 'Photo grid',
  open: 'View larger',
  lightboxLabel: 'Photo viewer',
  previous: 'Previous photo',
  next: 'Next photo',
  counter: (index: number, total: number) => `${index} / ${total}`,
};
