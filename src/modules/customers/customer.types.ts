export interface CustomerWebhook {
  url: string;
  secret: string;
}

export interface CustomerDocument {
  _id: string;
  webhook: CustomerWebhook | null;
  createdAt: Date;
  updatedAt: Date;
}
