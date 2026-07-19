import { ReactNode } from 'react';
import '@hanzo/react-zen';

declare module '@hanzo/react-zen' {
  interface SelectProps {
    children?: ReactNode;
  }

  interface TooltipProps {
    children?: ReactNode;
  }
}
