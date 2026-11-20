import { unsafeUniformIntDistribution } from 'pure-rand/distribution/uniformInt';
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus';

const seed = Date.now() ^ (Math.random() * 0x100000000);
const rng = xoroshiro128plus(seed);

export function random(min: number, max: number) {
  return unsafeUniformIntDistribution(min, max, rng);
}

export function getRandomChars(
  n: number,
  chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
) {
  const arr = chars.split('');
  let s = '';
  for (let i = 0; i < n; i++) {
    s += arr[random(0, arr.length - 1)];
  }
  return s;
}
