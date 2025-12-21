import type { ActivityType } from '@/types';

export function getActivityIcon(type: ActivityType): string {
  const iconMap: Record<string, string> = {
    Ride: 'bike',
    Run: 'run',
    Swim: 'swim',
    OpenWaterSwim: 'swim',
    Walk: 'walk',
    Hike: 'hiking',
    VirtualRide: 'bike',
    VirtualRun: 'run',
    Workout: 'dumbbell',
    WeightTraining: 'weight-lifter',
    Yoga: 'yoga',
    Snowboard: 'snowboard',
    AlpineSki: 'ski',
    NordicSki: 'ski-cross-country',
    BackcountrySki: 'ski',
    Rowing: 'rowing',
    Kayaking: 'kayaking',
    Canoeing: 'kayaking',
    Other: 'heart-pulse',
  };
  return iconMap[type] || 'heart-pulse';
}

export function getActivityColor(type: ActivityType): string {
  const colorMap: Record<string, string> = {
    Ride: '#5B9BD5',
    Run: '#4CAF50',
    Swim: '#2196F3',
    OpenWaterSwim: '#2196F3',
    Walk: '#9C27B0',
    Hike: '#795548',
    VirtualRide: '#5B9BD5',
    VirtualRun: '#4CAF50',
    Workout: '#607D8B',
    WeightTraining: '#607D8B',
    Yoga: '#E91E63',
    Snowboard: '#00BCD4',
    AlpineSki: '#03A9F4',
    NordicSki: '#00BCD4',
    BackcountrySki: '#03A9F4',
    Rowing: '#009688',
    Kayaking: '#009688',
    Canoeing: '#009688',
    Other: '#9E9E9E',
  };
  return colorMap[type] || '#9E9E9E';
}

export function isRunningActivity(type: ActivityType): boolean {
  return ['Run', 'VirtualRun', 'Walk', 'Hike'].includes(type);
}

export function isCyclingActivity(type: ActivityType): boolean {
  return ['Ride', 'VirtualRide'].includes(type);
}
