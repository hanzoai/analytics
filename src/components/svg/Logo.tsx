import type { SVGProps } from 'react';

import { MARK_BLOCKS } from '@hanzo/logo/logos';

const SvgLogo = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={20}
    height={20}
    fill="currentColor"
    viewBox="0 0 67 67"
    {...props}
  >
    {MARK_BLOCKS.map((d) => (
      <path key={d} d={d} />
    ))}
  </svg>
);
export default SvgLogo;
