import { 
  clients, type Client, type ClientCredential, clientCredentials,
  actionLogs, type ActionLog,
  analysisSnapshots, type AnalysisSnapshot,
  apiConfigs, type ApiConfig
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc } from "drizzle-orm";

export interface IStorage {
  // Clients
  getClient(id: string): Promise<Client | undefined>;
  getAllClients(): Promise<Client[]>;
  createClient(client: any): Promise<Client>;
  updateClient(id: string, client: any): Promise<Client>;
  deleteClient(id: string): Promise<void>;

  // Credentials
  getCredentials(clientId: string): Promise<ClientCredential | undefined>;
  saveCredentials(clientId: string, data: any): Promise<ClientCredential>;
  deleteCredentials(clientId: string): Promise<void>;

  // Analysis Snapshots
  saveAnalysisSnapshot(clientId: string, platform: string, cadence: string, data: any): Promise<AnalysisSnapshot>;
  loadAnalysisSnapshot(clientId: string, platform: string, cadence?: string): Promise<AnalysisSnapshot | undefined>;

  // API Configs
  getApiConfig(): Promise<ApiConfig | undefined>;
  updateApiConfig(config: any): Promise<ApiConfig>;
}

export class DatabaseStorage implements IStorage {
  // Clients
  async getClient(id: string): Promise<Client | undefined> {
    const [client] = await db.select().from(clients).where(eq(clients.id, id));
    return client;
  }

  async getAllClients(): Promise<Client[]> {
    return await db.select().from(clients);
  }

  async createClient(insertClient: any): Promise<Client> {
    const [client] = await db.insert(clients).values(insertClient).returning();
    return client;
  }

  async updateClient(id: string, updateData: any): Promise<Client> {
    const [client] = await db
      .update(clients)
      .set({ ...updateData, updatedAt: new Date() })
      .where(eq(clients.id, id))
      .returning();
    return client;
  }

  async deleteClient(id: string): Promise<void> {
    await db.delete(clients).where(eq(clients.id, id));
  }

  // Credentials
  async getCredentials(clientId: string): Promise<ClientCredential | undefined> {
    const [creds] = await db.select().from(clientCredentials).where(eq(clientCredentials.clientId, clientId));
    return creds;
  }

  async saveCredentials(clientId: string, data: any): Promise<ClientCredential> {
    const existing = await this.getCredentials(clientId);
    if (existing) {
      const [updated] = await db
        .update(clientCredentials)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(clientCredentials.clientId, clientId))
        .returning();
      return updated;
    } else {
      const [inserted] = await db
        .insert(clientCredentials)
        .values({ clientId, ...data })
        .returning();
      return inserted;
    }
  }

  async deleteCredentials(clientId: string): Promise<void> {
    await db.delete(clientCredentials).where(eq(clientCredentials.clientId, clientId));
  }

  // Analysis Snapshots
  async saveAnalysisSnapshot(clientId: string, platform: string, cadence: string, data: any): Promise<AnalysisSnapshot> {
    const [snap] = await db
      .insert(analysisSnapshots)
      .values({ clientId, platform, cadence, data })
      .onConflictDoUpdate({
        target: [analysisSnapshots.clientId, analysisSnapshots.platform, analysisSnapshots.cadence],
        set: { data, createdAt: new Date() }
      })
      .returning();
    return snap;
  }

  async loadAnalysisSnapshot(clientId: string, platform: string, cadence: string = "twice_weekly"): Promise<AnalysisSnapshot | undefined> {
    const [snap] = await db
      .select()
      .from(analysisSnapshots)
      .where(and(
        eq(analysisSnapshots.clientId, clientId),
        eq(analysisSnapshots.platform, platform),
        eq(analysisSnapshots.cadence, cadence)
      ))
      .limit(1);
    return snap;
  }

  // API Configs
  async getApiConfig(): Promise<ApiConfig | undefined> {
    const [config] = await db.select().from(apiConfigs).limit(1);
    return config;
  }

  async updateApiConfig(config: any): Promise<ApiConfig> {
    const existing = await this.getApiConfig();
    if (existing) {
      const [updated] = await db
        .update(apiConfigs)
        .set({ ...config, updatedAt: new Date() })
        .where(eq(apiConfigs.id, existing.id))
        .returning();
      return updated;
    } else {
      const [inserted] = await db.insert(apiConfigs).values(config).returning();
      return inserted;
    }
  }
}

export const storage = new DatabaseStorage();
