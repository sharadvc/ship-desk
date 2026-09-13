import { html, nothing, render } from "lit";
import type { ProjectDeployState } from "../deploy/deploy-service.js";
import { openExternalUrl } from "../deploy/deploy-service.js";

export interface DeployPanelModel {
	projectPath: string | null;
	projectName: string | null;
	state: ProjectDeployState | null;
	shipping: boolean;
	error: string | null;
	lastActionMessage: string | null;
}

export class DeployPanel {
	private container: HTMLElement;
	private model: DeployPanelModel = {
		projectPath: null,
		projectName: null,
		state: null,
		shipping: false,
		error: null,
		lastActionMessage: null,
	};
	private onShip: (() => void | Promise<void>) | null = null;
	private onRefresh: (() => void | Promise<void>) | null = null;

	constructor(container: HTMLElement) {
		this.container = container;
		this.render();
	}

	setModel(patch: Partial<DeployPanelModel>): void {
		this.model = { ...this.model, ...patch };
		this.render();
	}

	setOnShip(cb: () => void | Promise<void>): void {
		this.onShip = cb;
	}

	setOnRefresh(cb: () => void | Promise<void>): void {
		this.onRefresh = cb;
	}

	render(): void {
		const { projectPath, projectName, state, shipping, error, lastActionMessage } = this.model;
		const provider = state?.provider ?? "Vercel";
		const status = state?.status ?? (projectPath ? "Not deployed" : "—");
		const liveUrl = state?.liveUrl ?? state?.previewUrl ?? null;
		const domainLabel = state?.domain?.trim() || "Not set";

		render(
			html`
				<div class="deploy-panel">
					<div class="deploy-panel-header">
						<h2 class="deploy-panel-title">Deploy</h2>
						<button
							class="deploy-panel-refresh"
							title="Refresh deploy status"
							?disabled=${!projectPath || shipping}
							@click=${() => {
								if (!projectPath) return;
								void this.onRefresh?.();
							}}
						>
							↻
						</button>
					</div>

					${projectPath
						? html`
							<div class="deploy-panel-project" title=${projectPath}>
								${projectName ?? "Project"}
							</div>
						`
						: html`<div class="deploy-panel-empty">Open a project folder to ship.</div>`}

					<dl class="deploy-kv-list">
						<div class="deploy-kv-row">
							<dt>Provider</dt>
							<dd>${provider}</dd>
						</div>
						<div class="deploy-kv-row">
							<dt>Status</dt>
							<dd class=${status === "Ready" ? "deploy-status-ready" : ""}>${status}</dd>
						</div>
						<div class="deploy-kv-row">
							<dt>Live URL</dt>
							<dd>
								${liveUrl
									? html`<button class="deploy-link-btn" @click=${() => void openExternalUrl(liveUrl)}>${liveUrl}</button>`
									: "—"}
							</dd>
						</div>
						<div class="deploy-kv-row">
							<dt>Domain</dt>
							<dd class="deploy-domain-muted">${domainLabel}</dd>
						</div>
					</dl>

					<button class="deploy-connect-domain" type="button" disabled title="Custom domains come later">
						Connect domain…
					</button>

					${error ? html`<div class="deploy-panel-error" role="alert">${error}</div>` : nothing}
					${lastActionMessage && !error
						? html`<div class="deploy-panel-message">${lastActionMessage}</div>`
						: nothing}
					${shipping ? html`<div class="deploy-panel-message">Shipping to Vercel…</div>` : nothing}
				</div>
			`,
			this.container,
		);
	}
}
