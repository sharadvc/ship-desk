import type { ChatView } from "./components/chat-view.js";
import { DeployPanel } from "./components/deploy-panel.js";
import { ShipDeskContextBar } from "./components/ship-desk-context-bar.js";
import {
	getStoredVercelToken,
	loadProjectDeployState,
	loadVercelSetupStatus,
	openProjectPreview,
	shipProjectToVercel,
	type ProjectDeployState,
} from "./deploy/deploy-service.js";

export interface ShipDeskControllerDeps {
	getActiveProjectPath: () => string | null;
	getActiveProjectName: () => string | null;
	getChatView: () => ChatView | null;
	onDeployStateChange?: (state: ProjectDeployState | null) => void;
	renderApp: () => void;
}

export class ShipDeskController {
	private deployPanel: DeployPanel | null = null;
	private contextBar: ShipDeskContextBar | null = null;
	private deps: ShipDeskControllerDeps;
	private shipping = false;
	private deployState: ProjectDeployState | null = null;
	private lastError: string | null = null;
	private lastActionMessage: string | null = null;

	constructor(deps: ShipDeskControllerDeps) {
		this.deps = deps;
	}

	mount(): void {
		const deployContainer = document.getElementById("deploy-pane");
		const contextContainer = document.getElementById("ship-desk-context-bar");
		if (deployContainer) {
			this.deployPanel = new DeployPanel(deployContainer);
			this.deployPanel.setOnShip(() => this.handleShip());
			this.deployPanel.setOnRefresh(() => this.refreshDeployState());
		}
		if (contextContainer) {
			this.contextBar = new ShipDeskContextBar(contextContainer);
		}

		const chat = this.deps.getChatView();
		chat?.setOnPreviewProject(() => this.handlePreview());
		chat?.setOnShipProject(() => this.handleShip());
		this.syncUi(this.deps.getActiveProjectName());
	}

	async refreshDeployState(): Promise<void> {
		const projectPath = this.deps.getActiveProjectPath();
		const projectName = this.deps.getActiveProjectName();
		if (!projectPath) {
			this.deployState = null;
			this.syncUi(projectName);
			return;
		}
		try {
			this.deployState = await loadProjectDeployState(projectPath);
			this.lastError = this.deployState.lastError;
		} catch (err) {
			this.lastError = err instanceof Error ? err.message : String(err);
			this.deployState = null;
		}
		this.syncUi(projectName);
		this.deps.onDeployStateChange?.(this.deployState);
	}

	private syncUi(projectName: string | null): void {
		const projectPath = this.deps.getActiveProjectPath();
		this.deployPanel?.setModel({
			projectPath,
			projectName,
			state: this.deployState,
			shipping: this.shipping,
			error: this.lastError,
			lastActionMessage: this.lastActionMessage,
		});
		const liveUrl = this.deployState?.liveUrl ?? this.deployState?.previewUrl ?? null;
		this.contextBar?.setModel({
			projectName,
			liveUrl,
			isLive: Boolean(liveUrl) && (this.deployState?.status === "Ready" || this.deployState?.status === "Deployed"),
		});
		this.deps.getChatView()?.setShipDeskShipping(this.shipping);
	}

	private async handlePreview(): Promise<void> {
		const projectPath = this.deps.getActiveProjectPath();
		if (!projectPath) {
			this.lastError = "Open a project folder before previewing.";
			this.syncUi(this.deps.getActiveProjectName());
			return;
		}
		this.lastError = null;
		try {
			const result = await openProjectPreview(projectPath, true);
			this.lastActionMessage = result.message;
		} catch (err) {
			this.lastError = err instanceof Error ? err.message : String(err);
		}
		this.syncUi(this.deps.getActiveProjectName());
	}

	private async handleShip(): Promise<void> {
		const projectPath = this.deps.getActiveProjectPath();
		if (!projectPath) {
			this.lastError = "Open a project folder before shipping.";
			this.syncUi(this.deps.getActiveProjectName());
			return;
		}

		this.shipping = true;
		this.lastError = null;
		this.lastActionMessage = null;
		this.syncUi(this.deps.getActiveProjectName());

		try {
			const token = await getStoredVercelToken();
			const setup = await loadVercelSetupStatus(token);
			if (!setup.cliAvailable && !setup.tokenConfigured && !token) {
				throw new Error(
					`Vercel CLI is not installed and no token is saved. Install with \`npm install -g vercel\`, run \`vercel login\`, or add a Vercel token in Settings → General. ${setup.loggedInHint}`,
				);
			}

			const result = await shipProjectToVercel(projectPath, token);
			this.deployState = result.state;
			this.lastActionMessage = result.message;
			if (!result.ok || !result.url) {
				this.lastError =
					result.state.lastError ??
					"Ship finished without a live URL. Check the Vercel dashboard or run `vercel deploy --prod` in Terminal.";
			}
		} catch (err) {
			this.lastError = err instanceof Error ? err.message : String(err);
		} finally {
			this.shipping = false;
			await this.refreshDeployState();
		}
	}

	onProjectChanged(): void {
		void this.refreshDeployState();
	}
}
