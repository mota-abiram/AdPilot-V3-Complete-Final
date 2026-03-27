// No DB storage needed for this dashboard — data comes from JSON file
// Recommendation actions are stored in-memory in routes.ts

export interface IStorage {}

export class MemStorage implements IStorage {}

export const storage = new MemStorage();
