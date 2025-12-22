import {
  getActivityIcon,
  getActivityColor,
  isRunningActivity,
  isCyclingActivity,
} from '../lib/activityUtils';
import type { ActivityType } from '../types';

describe('getActivityIcon', () => {
  it('should return correct icon for cycling activities', () => {
    expect(getActivityIcon('Ride')).toBe('bike');
    expect(getActivityIcon('VirtualRide')).toBe('bike');
  });

  it('should return correct icon for running activities', () => {
    expect(getActivityIcon('Run')).toBe('run');
    expect(getActivityIcon('VirtualRun')).toBe('run');
  });

  it('should return correct icon for swimming activities', () => {
    expect(getActivityIcon('Swim')).toBe('swim');
    expect(getActivityIcon('OpenWaterSwim')).toBe('swim');
  });

  it('should return correct icon for hiking/walking', () => {
    expect(getActivityIcon('Walk')).toBe('walk');
    expect(getActivityIcon('Hike')).toBe('hiking');
  });

  it('should return correct icon for winter sports', () => {
    expect(getActivityIcon('Snowboard')).toBe('snowboard');
    expect(getActivityIcon('AlpineSki')).toBe('ski');
    expect(getActivityIcon('NordicSki')).toBe('ski-cross-country');
    expect(getActivityIcon('BackcountrySki')).toBe('ski');
  });

  it('should return correct icon for water sports', () => {
    expect(getActivityIcon('Rowing')).toBe('rowing');
    expect(getActivityIcon('Kayaking')).toBe('kayaking');
    expect(getActivityIcon('Canoeing')).toBe('kayaking');
  });

  it('should return correct icon for gym activities', () => {
    expect(getActivityIcon('Workout')).toBe('dumbbell');
    expect(getActivityIcon('WeightTraining')).toBe('weight-lifter');
    expect(getActivityIcon('Yoga')).toBe('yoga');
  });

  it('should return fallback icon for Other and unknown types', () => {
    expect(getActivityIcon('Other')).toBe('heart-pulse');
    // Unknown type should fallback
    expect(getActivityIcon('UnknownType' as ActivityType)).toBe('heart-pulse');
  });
});

describe('getActivityColor', () => {
  it('should return orange for cycling activities', () => {
    expect(getActivityColor('Ride')).toBe('#FF5722');
    expect(getActivityColor('VirtualRide')).toBe('#FF5722');
  });

  it('should return green for running activities', () => {
    expect(getActivityColor('Run')).toBe('#4CAF50');
    expect(getActivityColor('VirtualRun')).toBe('#4CAF50');
  });

  it('should return blue for swimming activities', () => {
    expect(getActivityColor('Swim')).toBe('#2196F3');
    expect(getActivityColor('OpenWaterSwim')).toBe('#2196F3');
  });

  it('should return purple for walking', () => {
    expect(getActivityColor('Walk')).toBe('#9C27B0');
  });

  it('should return brown for hiking', () => {
    expect(getActivityColor('Hike')).toBe('#795548');
  });

  it('should return gray for Other and unknown types', () => {
    expect(getActivityColor('Other')).toBe('#9E9E9E');
    expect(getActivityColor('UnknownType' as ActivityType)).toBe('#9E9E9E');
  });
});

describe('isRunningActivity', () => {
  it('should return true for running activities', () => {
    expect(isRunningActivity('Run')).toBe(true);
    expect(isRunningActivity('VirtualRun')).toBe(true);
    expect(isRunningActivity('Walk')).toBe(true);
    expect(isRunningActivity('Hike')).toBe(true);
  });

  it('should return false for non-running activities', () => {
    expect(isRunningActivity('Ride')).toBe(false);
    expect(isRunningActivity('Swim')).toBe(false);
    expect(isRunningActivity('VirtualRide')).toBe(false);
    expect(isRunningActivity('Workout')).toBe(false);
    expect(isRunningActivity('Other')).toBe(false);
  });
});

describe('isCyclingActivity', () => {
  it('should return true for cycling activities', () => {
    expect(isCyclingActivity('Ride')).toBe(true);
    expect(isCyclingActivity('VirtualRide')).toBe(true);
  });

  it('should return false for non-cycling activities', () => {
    expect(isCyclingActivity('Run')).toBe(false);
    expect(isCyclingActivity('Swim')).toBe(false);
    expect(isCyclingActivity('Walk')).toBe(false);
    expect(isCyclingActivity('Workout')).toBe(false);
    expect(isCyclingActivity('Other')).toBe(false);
  });
});
