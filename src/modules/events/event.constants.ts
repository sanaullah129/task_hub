export const EVENT_TYPES = ['task.completed', 'task.failed', 'task.timed_out'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const DELIVERY_STATUSES = ['Pending', 'Delivered', 'Failed', 'Skipped'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
