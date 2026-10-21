import { Schema } from 'mongoose';
import { baseSchemaOptions } from '../../shared/database/schemaOptions';
import type { CustomerDocument } from './customer.types';

export const customerSchema = new Schema<CustomerDocument>(
  {
    _id: { type: String, required: true },
    webhook: {
      type: new Schema(
        { url: { type: String, required: true }, secret: { type: String, required: true } },
        { _id: false },
      ),
      default: null,
    },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { ...baseSchemaOptions, collection: 'customers', autoIndex: false },
);
