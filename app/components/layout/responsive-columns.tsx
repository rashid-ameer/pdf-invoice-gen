import type {ReactNode} from 'react';

/** Phone only. Desktop values are the fallback so the current layout stays. */
const PHONE = '(inline-size < 480px)';

export const COLS_2 =
  `@container ${PHONE} minmax(0, 1fr), 'minmax(0, 1fr) minmax(0, 1fr)'`;

export const COLS_3 =
  `@container ${PHONE} minmax(0, 1fr), 'repeat(3, minmax(0, 1fr))'`;

export const COLS_4 =
  `@container ${PHONE} 'repeat(2, minmax(0, 1fr))', 'repeat(4, minmax(0, 1fr))'`;

export const COLS_SEARCH_FILTER =
  `@container ${PHONE} minmax(0, 1fr), '1fr 260px'`;

export const COLS_MAIN_AUTO =
  `@container ${PHONE} minmax(0, 1fr), 'minmax(0, 1fr) auto'`;

export const COLS_SIDEBAR =
  `@container ${PHONE} minmax(0, 1fr), '260px minmax(0, 1fr)'`;

export const COLS_EDITOR =
  `@container ${PHONE} minmax(0, 1fr), 'minmax(0, 1fr) minmax(0, 1.4fr)'`;

export const COLS_3_PLUS_ACTION =
  `@container ${PHONE} minmax(0, 1fr), '1fr 1fr 1fr auto'`;

export const COLS_ICON_PICKER =
  `@container ${PHONE} 'repeat(4, minmax(0, 1fr))', 'repeat(8, minmax(0, 1fr))'`;

export const COLS_TIMER_LABELS =
  `@container ${PHONE} 'repeat(2, minmax(0, 1fr))', '1fr 1fr 1fr 1fr'`;

export function choiceCardColumns(count: number) {
  return `@container ${PHONE} minmax(0, 1fr), 'repeat(${count}, 1fr)'`;
}

type GridGap =
  | 'none'
  | 'small-300'
  | 'small-200'
  | 'small'
  | 'base'
  | 'large';
type GridPadding = 'none' | 'small' | 'base';
type GridAlign =
  | 'normal'
  | 'stretch'
  | 'start'
  | 'center'
  | 'end'
  | 'baseline'
  | '';

export function ResponsiveGrid({
  children,
  gridTemplateColumns,
  gap,
  alignItems,
  padding,
}: {
  children?: ReactNode;
  gridTemplateColumns?: string;
  gap?: GridGap;
  alignItems?: GridAlign;
  padding?: GridPadding;
}) {
  return (
    <s-query-container>
      <s-grid
        gridTemplateColumns={gridTemplateColumns}
        gap={gap}
        alignItems={alignItems}
        padding={padding}
      >
        {children}
      </s-grid>
    </s-query-container>
  );
}
