import { Schema } from 'mongoose';

export const leaseSchema = new Schema(
  { workerId: { type: String, required: true }, expiresAt: { type: Date, required: true } },
  { _id: false },
);

// Dates are set by the domain layer, versioning is off so array CAS updates are not affected by __v.
export const baseSchemaOptions = { versionKey: false, timestamps: false, minimize: false } as const;
