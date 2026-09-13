import { html, nothing, render } from "lit";
import { openExternalUrl } from "../deploy/deploy-service.js";

export interface ShipDeskContextBarModel {
	projectName: string | null;
	liveUrl: string | null;
	isLive: boolean;
}

export class ShipDeskContextBar {
	private container: HTMLElement;
	private model: ShipDeskContextBarModel = {
		projectName: null,
		liveUrl: null,
		isLive: false,
	};

	constructor(container: HTMLElement) {
		this.container = container;
		this.render();
	}

	setModel(patch: Partial<ShipDeskContextBarModel>): void {
		this.model = { ...this.model, ...patch };
		this.render();
	}

	render(): void {
		const { projectName, liveUrl, isLive } = this.model;
		render(
			html`
				<div class="ship-desk-context-bar" data-tauri-drag-region>
					<div class="ship-desk-breadcrumb">
						<span class="ship-desk-crumb-muted">Projects</span>
						<span class="ship-desk-crumb-sep">/</span>
						<span class="ship-desk-crumb-active">${projectName ?? "No project"}</span>
					</div>
					<div class="ship-desk-context-actions">
						${liveUrl
							? html`
								<button class="ship-desk-preview-link" @click=${() => void openExternalUrl(liveUrl)}>
									${this.shortHost(liveUrl)}
								</button>
								${isLive ? html`<span class="ship-desk-live-pill">Live</span>` : nothing}
							`
							: nothing}
					</div>
				</div>
			`,
			this.container,
		);
	}

	private shortHost(url: string): string {
		try {
			const parsed = new URL(url);
			return parsed.host;
		} catch {
			return url;
		}
	}
}
