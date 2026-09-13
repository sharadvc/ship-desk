import { invoke } from "@tauri-apps/api/core";

export interface ProjectDeployState {
	provider: string;
	status: string;
	liveUrl: string | null;
	previewUrl: string | null;
	domain: string | null;
	lastError: string | null;
	lastDeployedAt: number | null;
}

export interface VercelDeployResult {
	ok: boolean;
	url: string | null;
	stdout: string;
	stderr: string;
	message: string;
	state: ProjectDeployState;
}

export interface VercelSetupStatus {
	cliAvailable: boolean;
	cliPath: string | null;
	loggedInHint: string;
	tokenConfigured: boolean;
}

export async function loadProjectDeployState(projectPath: string): Promise<ProjectDeployState> {
	return (await invoke("get_project_deploy_state", { projectPath })) as ProjectDeployState;
}

export async function loadVercelSetupStatus(vercelToken?: string | null): Promise<VercelSetupStatus> {
	return (await invoke("get_vercel_setup_status", {
		vercelToken: vercelToken?.trim() || null,
	})) as VercelSetupStatus;
}

export async function shipProjectToVercel(
	projectPath: string,
	vercelToken?: string | null,
): Promise<VercelDeployResult> {
	return (await invoke("vercel_ship_project", {
		projectPath,
		vercelToken: vercelToken?.trim() || null,
	})) as VercelDeployResult;
}

export async function openProjectPreview(projectPath: string, preferLive = true): Promise<{ ok: boolean; url: string; message: string }> {
	return (await invoke("open_project_preview", { projectPath, preferLive })) as {
		ok: boolean;
		url: string;
		message: string;
	};
}

export async function openExternalUrl(url: string): Promise<void> {
	await invoke("open_external_url", { url });
}

let cachedVercelToken: string | null = null;

export async function getStoredVercelToken(): Promise<string | null> {
	if (cachedVercelToken !== null) return cachedVercelToken || null;
	try {
		const saved = (await invoke("load_settings")) as { vercel_token?: string | null };
		const token = saved.vercel_token?.trim() || "";
		cachedVercelToken = token;
		return token || null;
	} catch {
		return null;
	}
}

export function invalidateVercelTokenCache(): void {
	cachedVercelToken = null;
}
