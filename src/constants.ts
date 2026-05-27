export const SHINGLE_SIZE = 4;


export const MAX_VELOCITY_MEMBERS = 500;


export const CLUSTER_WINDOW_MS = 180_000;


export const VELOCITY_WINDOW_MS = 60_000;



export const KEYS = {
  lockdown:           (id: string) => `raidshield:lockdown:${id}`,
  lockdownReason:     (id: string) => `raidshield:lockdown:reason:${id}`,
  lockdownTriggeredBy:(id: string) => `raidshield:lockdown:by:${id}`,
  velocityPosts:      (id: string) => `raidshield:velocity:posts:${id}`,
  velocityComments:   (id: string) => `raidshield:velocity:comments:${id}`,
  newAccountVelocity: (id: string) => `raidshield:velocity:newaccts:${id}`,
  clusterHash:        (id: string, hash: string) => `raidshield:cluster:${id}:${hash}`,
  incidentCount:      (id: string) => `raidshield:incidents:${id}`,
  incidentLog:        (id: string) => `raidshield:incidentlog:${id}`,
  dashboardPostId:    (id: string) => `raidshield:dashboard:postid:${id}`,
} as const;
