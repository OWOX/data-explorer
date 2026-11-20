import { useLayoutEffect, useRef } from 'react';

/** A ref that holds the value of the latest render, so a listener set up once in an effect reads fresh props. It updates after each commit. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => { ref.current = value; });
  return ref;
}
