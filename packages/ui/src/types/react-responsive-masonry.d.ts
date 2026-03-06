declare module "react-responsive-masonry" {
  import { ComponentType, ReactNode } from "react";
  interface MasonryProps {
    columnsCount?: number;
    gutter?: string;
    sequential?: boolean;
    containerTag?: string;
    itemTag?: string;
    itemStyle?: React.CSSProperties;
    children?: ReactNode;
  }
  interface ResponsiveMasonryProps {
    columnsCountBreakPoints?: Record<number, number>;
    gutterBreakpoints?: Record<number, string>;
    children?: ReactNode;
  }
  const Masonry: ComponentType<MasonryProps>;
  export const ResponsiveMasonry: ComponentType<ResponsiveMasonryProps>;
  export default Masonry;
}
