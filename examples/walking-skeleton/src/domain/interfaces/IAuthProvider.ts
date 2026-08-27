export interface AuthUser {
  id: string
}

export interface IAuthProvider {
  getUser(req: Request): Promise<AuthUser | null>
}
