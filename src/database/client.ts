import mongoose, { type Connection, type Model } from 'mongoose';
import type { Config } from '../config/config';
import { customerSchema, type CustomerDocument } from '../modules/customers';
import { eventSchema, type EventDocument } from '../modules/events';
import { taskSchema, type TaskDocument } from '../modules/tasks';

export interface Database {
  connection: Connection;
  tasks: Model<TaskDocument>;
  events: Model<EventDocument>;
  customers: Model<CustomerDocument>;
  close(): Promise<void>;
}

export async function connectDatabase({ uri, dbName }: Config['mongo']): Promise<Database> {
  const connection = await mongoose
    .createConnection(uri, { dbName, serverSelectionTimeoutMS: 5_000, autoIndex: false })
    .asPromise();
  return {
    connection,
    tasks: connection.model<TaskDocument>('Task', taskSchema),
    events: connection.model<EventDocument>('Event', eventSchema),
    customers: connection.model<CustomerDocument>('Customer', customerSchema),
    close: () => connection.close(),
  };
}
