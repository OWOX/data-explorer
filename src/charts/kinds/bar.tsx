import { ChartColumnBig } from 'lucide-react';
import { categoryBar, type CategoryBarR } from './categoryBar';

export type BarR = CategoryBarR;
export const bar = categoryBar('bar', 'Bar chart', ChartColumnBig, 'vertical');
