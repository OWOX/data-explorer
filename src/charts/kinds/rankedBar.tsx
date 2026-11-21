import { ChartBarDecreasing } from 'lucide-react';
import { categoryBar, type CategoryBarR } from './categoryBar';

export type RankedR = CategoryBarR;
export const rankedBar = categoryBar('rankedBar', 'Ranked bar', ChartBarDecreasing, 'horizontal');
