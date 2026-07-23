/**
 * UA-first device classification with a small capability fallback for iPadOS
 * and browsers that reduce the user-agent string.
 */
export function detectDeviceProfile({
  userAgent = '',
  maxTouchPoints = 0,
  coarsePointer = false,
  viewportWidth = 1280,
} = {}) {
  const ua = String(userAgent);
  const ipadDesktopMode = /Macintosh/i.test(ua) && maxTouchPoints > 1;
  const tabletUa = /iPad|Tablet|PlayBook|Silk/i.test(ua)
    || (/Android/i.test(ua) && !/Mobile/i.test(ua));
  const mobileUa = /iPhone|iPod|Android.*Mobile|Windows Phone|IEMobile|Opera Mini|Mobile/i.test(ua);

  let type = 'desktop';
  if (ipadDesktopMode || tabletUa) type = 'tablet';
  else if (mobileUa) type = 'mobile';
  else if (coarsePointer && maxTouchPoints > 0 && viewportWidth <= 1024) {
    type = viewportWidth >= 768 ? 'tablet' : 'mobile';
  }

  return {
    type,
    isMobile: type === 'mobile',
    isTablet: type === 'tablet',
    isTouch: maxTouchPoints > 0 || coarsePointer,
    prefersLandscape: type === 'mobile',
  };
}

export default detectDeviceProfile;
