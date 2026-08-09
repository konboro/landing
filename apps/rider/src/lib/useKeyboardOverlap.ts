// How much of the window the keyboard currently covers, in points.
//
// Why a measurement instead of <KeyboardAvoidingView>: the Android manifest asks
// for `adjustResize`, but Expo SDK 54 ships edge-to-edge, and on Android 15+ an
// edge-to-edge window is NOT resized for the keyboard. So the same
// KeyboardAvoidingView behaviour is right on one device and wrong on the next,
// which is how the Continue button ended up under the keyboard.
//
// `endCoordinates.screenY` is where the keyboard's top edge sits on the physical
// screen. Comparing it with the window height gives the real overlap and is
// self-correcting:
//   * window DID resize  → the window bottom is already above the keyboard, so
//     the overlap computes to ~0 and we add no padding (no double gap);
//   * window did NOT resize → the overlap is the keyboard height, which is
//     exactly the padding the layout needs.
import { useEffect, useState } from 'react';
import { Dimensions, Keyboard, Platform, type KeyboardEvent } from 'react-native';

export function useKeyboardOverlap(): number {
  const [overlap, setOverlap] = useState(0);

  useEffect(() => {
    // iOS reports the frame before the animation, so the layout moves WITH the
    // keyboard instead of snapping after it. Android only has the Did events.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (e: KeyboardEvent) => {
      const screenY = e?.endCoordinates?.screenY;
      if (typeof screenY !== 'number') return;
      const windowHeight = Dimensions.get('window').height;
      setOverlap(Math.max(0, windowHeight - screenY));
    };

    const show = Keyboard.addListener(showEvent, onShow);
    const hide = Keyboard.addListener(hideEvent, () => setOverlap(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return overlap;
}
