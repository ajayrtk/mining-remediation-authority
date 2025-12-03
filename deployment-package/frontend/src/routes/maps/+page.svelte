<script lang="ts">
	import { onDestroy } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';
	import type { MapEntry } from './+page.server';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';

	export let data: PageData;

	// Auto-refresh configuration
	const AUTO_REFRESH_INTERVAL = 30000; // 30 seconds - reduces server load and provides better UX
	let autoRefreshInterval: ReturnType<typeof setInterval> | null = null;

	let isRefreshing = false;

	let searchQuery = '';
	let currentPage = 1;
	const itemsPerPage = 10;
	let downloadingMapId: string | null = null;
	let deletingMapId: string | null = null;
	let retryingMapId: string | null = null;
	let confirmDeleteMap: MapEntry | null = null;

	// Bulk download state
	let selectedMaps: Set<string> = new Set();
	let bulkDownloading = false;

	// Sort state
	let sortColumn: 'mapName' | 'ownerEmail' | 'outputSizeBytes' | 'createdAt' | 'jobStatus' = 'createdAt';
	let sortDirection: 'asc' | 'desc' = 'desc';

	// User menu state
	let isUserMenuOpen = false;
	const toggleUserMenu = () => {
		isUserMenuOpen = !isUserMenuOpen;
	};
	const closeUserMenu = () => {
		isUserMenuOpen = false;
	};

	$: allMaps = (data.maps ?? []) as MapEntry[];
	$: user = data.user;

	// Calculate job statistics for job pipeline overview
	const statusGroups = ['QUEUED', 'DISPATCHED', 'PROCESSING', 'AWAITING_OUTPUT'];
	$: stats = {
		total: allMaps.length,
		active: allMaps.filter((map) => statusGroups.includes(map.jobStatus ?? '')).length,
		completed: allMaps.filter((map) => map.jobStatus === 'COMPLETED').length,
		failed: allMaps.filter((map) => map.jobStatus === 'FAILED').length
	};

	// Search functionality
	$: filteredMaps = allMaps.filter((map) => {
		if (!searchQuery) return true;
		const query = searchQuery.toLowerCase();
		return (
			map.mapName.toLowerCase().includes(query) ||
			map.ownerEmail.toLowerCase().includes(query)
		);
	});

	// Sort functionality
	$: sortedMaps = [...filteredMaps].sort((a, b) => {
		let compareResult = 0;

		switch (sortColumn) {
			case 'mapName':
				compareResult = a.mapName.localeCompare(b.mapName);
				break;
			case 'ownerEmail':
				compareResult = a.ownerEmail.localeCompare(b.ownerEmail);
				break;
			case 'outputSizeBytes':
				compareResult = (a.outputSizeBytes ?? 0) - (b.outputSizeBytes ?? 0);
				break;
			case 'createdAt':
				compareResult = (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
				break;
			case 'jobStatus':
				// Custom order: QUEUED < PROCESSING < DISPATCHED < COMPLETED < FAILED
				const statusOrder: Record<string, number> = {
					'QUEUED': 1,
					'DISPATCHED': 2,
					'PROCESSING': 3,
					'AWAITING_OUTPUT': 4,
					'COMPLETED': 5,
					'FAILED': 6,
					'UNKNOWN': 7
				};
				const aStatus = statusOrder[a.jobStatus ?? 'UNKNOWN'] ?? 7;
				const bStatus = statusOrder[b.jobStatus ?? 'UNKNOWN'] ?? 7;
				compareResult = aStatus - bStatus;
				break;
		}

		return sortDirection === 'asc' ? compareResult : -compareResult;
	});

	$: totalPages = Math.ceil(sortedMaps.length / itemsPerPage);
	$: paginatedMaps = sortedMaps.slice(
		(currentPage - 1) * itemsPerPage,
		currentPage * itemsPerPage
	);

	$: if (searchQuery) currentPage = 1;

	// Bulk download computed properties
	$: completedMapsOnPage = paginatedMaps.filter((map) => map.jobStatus === 'COMPLETED');
	$: allCompletedSelected = completedMapsOnPage.length > 0 && completedMapsOnPage.every((map) => selectedMaps.has(map.mapId));
	$: selectedCount = selectedMaps.size;

	// Bulk download functions
	const toggleMapSelection = (mapId: string) => {
		if (selectedMaps.has(mapId)) {
			selectedMaps.delete(mapId);
		} else {
			selectedMaps.add(mapId);
		}
		selectedMaps = selectedMaps; // Trigger reactivity
	};

	const toggleSelectAll = () => {
		if (allCompletedSelected) {
			// Deselect all completed maps on current page
			completedMapsOnPage.forEach((map) => selectedMaps.delete(map.mapId));
		} else {
			// Select all completed maps on current page
			completedMapsOnPage.forEach((map) => selectedMaps.add(map.mapId));
		}
		selectedMaps = selectedMaps; // Trigger reactivity
	};

	const bulkDownloadMaps = async () => {
		if (selectedCount === 0) return;

		bulkDownloading = true;
		try {
			// Get all selected map details
			const mapsToDownload = allMaps.filter((map) => selectedMaps.has(map.mapId));

			const response = await fetch('/api/bulk-download', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					maps: mapsToDownload.map((map) => ({
						mapId: map.mapId,
						mapName: map.mapName,
						bucket: map.s3Output?.bucket,
						key: map.s3Output?.key
					}))
				})
			});

			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.error || 'Failed to download maps');
			}

			// Get the ZIP file as a blob
			const blob = await response.blob();
			const url = window.URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = `maps-${new Date().toISOString().split('T')[0]}.zip`;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			window.URL.revokeObjectURL(url);

			// Clear selection after successful download
			selectedMaps.clear();
			selectedMaps = selectedMaps;
		} catch (error) {
			console.error('Bulk download failed:', error);
			alert(error instanceof Error ? error.message : 'Failed to download maps');
		} finally {
			bulkDownloading = false;
		}
	};

	const formatDate = (value?: string) => {
		if (!value) return '—';
		try {
			return new Date(value).toLocaleString();
		} catch {
			return value;
		}
	};

	const formatBytes = (bytes?: number) => {
		if (!bytes) return '—';
		const kb = bytes / 1024;
		const mb = kb / 1024;
		if (mb >= 1) return `${mb.toFixed(2)} MB`;
		if (kb >= 1) return `${kb.toFixed(2)} KB`;
		return `${bytes} B`;
	};

	// Format duration in human readable format
	const formatDuration = (ms: number): string => {
		if (ms < 0) return '—';
		const seconds = Math.floor(ms / 1000);
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = seconds % 60;
		if (minutes > 0) {
			return `${minutes}m ${remainingSeconds}s`;
		}
		return `${seconds}s`;
	};

	// Calculate timing metrics for a map
	const getTimingMetrics = (map: MapEntry) => {
		const metrics: { label: string; value: string; description: string }[] = [];

		if (!map.createdAt) return metrics;

		const created = new Date(map.createdAt).getTime();
		const dispatched = map.dispatchedAt ? new Date(map.dispatchedAt).getTime() : null;
		const started = map.taskStartedAt ? new Date(map.taskStartedAt).getTime() : null;
		const processed = map.processedAt ? new Date(map.processedAt).getTime() : null;
		const stopped = map.taskStoppedAt ? new Date(map.taskStoppedAt).getTime() : null;

		// Queue time: createdAt -> dispatchedAt
		if (dispatched) {
			const queueTime = dispatched - created;
			metrics.push({
				label: 'Queue Time',
				value: formatDuration(queueTime),
				description: 'Time waiting in queue before dispatch'
			});
		}

		// Startup time: dispatchedAt -> taskStartedAt
		if (dispatched && started) {
			const startupTime = started - dispatched;
			metrics.push({
				label: 'Startup Time',
				value: formatDuration(startupTime),
				description: 'ECS task provisioning and container startup'
			});
		}

		// Processing time: taskStartedAt -> processedAt or taskStoppedAt
		if (started) {
			const endTime = processed || stopped;
			if (endTime) {
				const processingTime = endTime - started;
				metrics.push({
					label: 'Processing Time',
					value: formatDuration(processingTime),
					description: 'Actual map processing duration'
				});
			}
		}

		// Total time: createdAt -> processedAt
		if (processed) {
			const totalTime = processed - created;
			metrics.push({
				label: 'Total Time',
				value: formatDuration(totalTime),
				description: 'End-to-end processing time'
			});
		}

		return metrics;
	};

	// Expanded row state for timing details
	let expandedMapId: string | null = null;

	const toggleExpanded = (mapId: string) => {
		expandedMapId = expandedMapId === mapId ? null : mapId;
	};

	const removeZipExtension = (filename: string) => filename.replace(/\.zip$/i, '');

	const nextPage = () => {
		if (currentPage < totalPages) currentPage += 1;
	};

	const prevPage = () => {
		if (currentPage > 1) currentPage -= 1;
	};

	const goToPage = (page: number) => {
		if (page >= 1 && page <= totalPages) currentPage = page;
	};

	const handleRefresh = async () => {
		isRefreshing = true;
		try {
			await invalidateAll();
		} catch (error) {
			console.error('Failed to refresh maps:', error);
		} finally {
			isRefreshing = false;
		}
	};

	const handleSort = (column: typeof sortColumn) => {
		if (sortColumn === column) {
			// Toggle direction if clicking the same column
			sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
		} else {
			// New column - set to ascending by default
			sortColumn = column;
			sortDirection = 'asc';
		}
		// Reset to first page when sorting changes
		currentPage = 1;
	};

	// Generate smart pagination with ellipsis
	$: pageNumbers = (() => {
		const delta = 2;
		const range = [];
		const rangeWithDots = [];
		let l;

		for (let i = 1; i <= totalPages; i++) {
			if (i === 1 || i === totalPages || (i >= currentPage - delta && i <= currentPage + delta)) {
				range.push(i);
			}
		}

		for (let i of range) {
			if (l) {
				if (i - l === 2) {
					rangeWithDots.push(l + 1);
				} else if (i - l !== 1) {
					rangeWithDots.push('...');
				}
			}
			rangeWithDots.push(i);
			l = i;
		}

		return rangeWithDots;
	})();

	// Generate presigned URL and download file
	const downloadFile = async (map: MapEntry) => {
		if (!map.s3Output?.bucket || !map.s3Output?.key) {
			alert('No output file available for this map.');
			return;
		}

		downloadingMapId = map.mapId;

		try {
			const response = await fetch('/api/download-url', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					bucket: map.s3Output.bucket,
					key: map.s3Output.key
				})
			});

			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.error || 'Failed to generate download URL');
			}

			const { url } = await response.json();

			const link = document.createElement('a');
			link.href = url;
			link.download = map.mapName || 'download';
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
		} catch (error) {
			console.error('Download failed:', error);
			alert(error instanceof Error ? error.message : 'Failed to download file');
		} finally {
			downloadingMapId = null;
		}
	};

	// Check if retry is available for a failed map (within 5 days)
	const isRetryAvailable = (map: MapEntry): boolean => {
		if (map.jobStatus !== 'FAILED') return false;

		const createdDate = new Date(map.createdAt);
		const now = new Date();
		const daysDiff = (now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24);

		return daysDiff <= 5;
	};

	// Retry failed map function
	const retryMap = async (map: MapEntry) => {
		if (!confirm(`🔄 Retry processing for "${removeZipExtension(map.mapName)}"?\n\nThis will resubmit the map for processing.`)) {
			return;
		}

		retryingMapId = map.mapId;

		try {
			const response = await fetch('/api/retry-map', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mapId: map.mapId,
					mapName: map.mapName
				})
			});

			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.error || 'Failed to retry map');
			}

			const result = await response.json();

			// Refresh the maps list
			await invalidateAll();

			alert(`Successfully retried "${removeZipExtension(map.mapName)}"`);
		} catch (error) {
			console.error('Retry failed:', error);
			alert(error instanceof Error ? error.message : 'Failed to retry map');
		} finally {
			retryingMapId = null;
		}
	};

	// Delete map function
	const deleteMap = async (map: MapEntry) => {
		if (!confirm(`⚠️ Are you sure you want to delete Map?\n\nThis will permanently delete this map and all its processed data.\nThis action cannot be undone.`)) {
			return;
		}

		deletingMapId = map.mapId;

		try {
			const response = await fetch('/api/delete-map', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mapId: map.mapId,
					mapName: map.mapName
				})
			});

			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.error || 'Failed to delete map');
			}

			const result = await response.json();

			// Refresh the maps list
			await invalidateAll();

			alert(`Successfully deleted "${removeZipExtension(map.mapName)}"`);
		} catch (error) {
			console.error('Delete failed:', error);
			alert(error instanceof Error ? error.message : 'Failed to delete map');
		} finally {
			deletingMapId = null;
		}
	};

	// Start auto-refresh when user is authenticated
	const startAutoRefresh = () => {
		if (autoRefreshInterval) return; // Already running

		autoRefreshInterval = setInterval(async () => {
			if (!isRefreshing) {
				await invalidateAll();
			}
		}, AUTO_REFRESH_INTERVAL);
	};

	// Stop auto-refresh
	const stopAutoRefresh = () => {
		if (autoRefreshInterval) {
			clearInterval(autoRefreshInterval);
			autoRefreshInterval = null;
		}
	};

	// Manage auto-refresh based on user authentication
	$: if (user) {
		startAutoRefresh();
	} else {
		stopAutoRefresh();
	}

	// Cleanup on component destroy
	onDestroy(() => {
		stopAutoRefresh();
	});
</script>

<div class="layout">
	<header class="top-bar">
		<div class="brand">
			<h1>Mine Plan Digitiser</h1>
			<p>Extract lines and text from georeferenced mine plans for GIS</p>
		</div>
		<div class="auth-actions">
			{#if user}
				<a class="button ghost" href="/">Dashboard</a>

				<div class="user-menu-container">
					<button class="user-menu-trigger" on:click={toggleUserMenu}>
						<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
							<circle cx="12" cy="7" r="4"></circle>
						</svg>
						<span class="chevron" class:open={isUserMenuOpen}>▼</span>
					</button>

					{#if isUserMenuOpen}
						<div class="menu-backdrop" on:click={closeUserMenu}></div>
						<div class="user-menu-dropdown">
							<div class="user-menu-header">
								<span class="user-email">{user.email ?? user.name ?? 'Account'}</span>
							</div>
							<div class="user-menu-divider"></div>
							<div class="user-menu-item">
								<span class="menu-label">Theme</span>
								<ThemeToggle variant="inline" />
							</div>
							<div class="user-menu-divider"></div>
							<a href="/auth/logout" class="user-menu-item logout">
								<svg
									xmlns="http://www.w3.org/2000/svg"
									fill="none"
									viewBox="0 0 24 24"
									stroke-width="1.5"
									stroke="currentColor"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"
									/>
								</svg>
								Sign out
							</a>
						</div>
					{/if}
				</div>
			{:else}
				<a class="button primary" href="/auth/login">Sign in</a>
			{/if}
		</div>
	</header>

	{#if !user}
		<section class="hero-landing">
			<div class="hero-icon">
				<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
					<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
					<polyline points="7.5 4.21 12 6.81 16.5 4.21"></polyline>
					<polyline points="7.5 19.79 7.5 14.6 3 12"></polyline>
					<polyline points="21 12 16.5 14.6 16.5 19.79"></polyline>
					<polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
					<line x1="12" y1="22.08" x2="12" y2="12"></line>
				</svg>
			</div>

			<div class="workflow-steps">
				<div class="workflow-step">
					<div class="step-number">1</div>
					<div class="step-icon">
						<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
							<polyline points="17 8 12 3 7 8"></polyline>
							<line x1="12" y1="3" x2="12" y2="15"></line>
						</svg>
					</div>
					<h3>Upload</h3>
					<p>ZIP files</p>
				</div>

				<div class="workflow-arrow">
					<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<polyline points="9 18 15 12 9 6"></polyline>
					</svg>
				</div>

				<div class="workflow-step">
					<div class="step-number">2</div>
					<div class="step-icon">
						<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<circle cx="12" cy="12" r="3"></circle>
							<path d="M12 1v6M12 17v6M4.22 4.22l4.24 4.24M15.54 15.54l4.24 4.24M1 12h6M17 12h6M4.22 19.78l4.24-4.24M15.54 8.46l4.24-4.24"></path>
						</svg>
					</div>
					<h3>Process</h3>
					<p>Automated</p>
				</div>

				<div class="workflow-arrow">
					<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<polyline points="9 18 15 12 9 6"></polyline>
					</svg>
				</div>

				<div class="workflow-step">
					<div class="step-number">3</div>
					<div class="step-icon">
						<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
							<polyline points="7 10 12 15 17 10"></polyline>
							<line x1="12" y1="15" x2="12" y2="3"></line>
						</svg>
					</div>
					<h3>Download</h3>
					<p>Results</p>
				</div>
			</div>
		</section>
	{:else}
		<section class="hero">
			<div class="hero-copy">
				<h2>Job pipeline overview</h2>
				<p>
					Each upload goes through automated validation, processing, and completion.<br />Track system performance and job reliability using the live counters.
				</p>
			</div>
			<div class="hero-stats">
				<div class="stat-card">
					<span class="label">Maps submitted</span>
					<strong>{stats.total}</strong>
				</div>
				<div class="stat-card">
					<span class="label">In progress</span>
					<strong>{stats.active}</strong>
				</div>
				<div class="stat-card">
					<span class="label">Completed</span>
					<strong>{stats.completed}</strong>
				</div>
				<div class="stat-card caution">
					<span class="label">Failed</span>
					<strong>{stats.failed}</strong>
				</div>
			</div>
		</section>
	{/if}

	{#if user}
		<section class="panel">
			<header class="panel-header">
				<div>
					<h2>All Maps</h2>
					<p class="meta">{allMaps.length} map{allMaps.length === 1 ? '' : 's'} in storage</p>
				</div>
				<div class="search-box">
					<input
						type="text"
						placeholder="Search maps..."
						bind:value={searchQuery}
						class="search-input"
					/>
					<button
						class="button ghost refresh-button"
						on:click={handleRefresh}
						disabled={isRefreshing}
						title="Refresh maps"
					>
						<svg
							class:spinning={isRefreshing}
							xmlns="http://www.w3.org/2000/svg"
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
						</svg>
						{isRefreshing ? 'Refreshing...' : 'Refresh'}
					</button>
					{#if selectedCount > 0}
						<button
							class="button primary download-selected-button"
							on:click={bulkDownloadMaps}
							disabled={bulkDownloading}
							title="Download selected maps as a ZIP file"
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								width="18"
								height="18"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
								<polyline points="7 10 12 15 17 10"></polyline>
								<line x1="12" y1="15" x2="12" y2="3"></line>
							</svg>
							{bulkDownloading ? 'Downloading...' : `Download Selected (${selectedCount})`}
						</button>
					{/if}
				</div>
			</header>

			{#if filteredMaps.length === 0}
				<p class="empty">
					{#if searchQuery}
						No maps found matching "{searchQuery}"
					{:else}
						No maps have been processed yet.
					{/if}
				</p>
			{:else}
				<div class="table-wrapper">
					<table>
						<thead>
							<tr>
								<th class="checkbox-column">
									<input
										type="checkbox"
										checked={allCompletedSelected}
										indeterminate={selectedCount > 0 && !allCompletedSelected}
										on:click={toggleSelectAll}
										disabled={completedMapsOnPage.length === 0}
										title={completedMapsOnPage.length === 0 ? 'No completed maps to select' : 'Select all completed maps'}
									/>
								</th>
								<th class="sortable" on:click={() => handleSort('mapName')}>
									<span class="th-content">
										Map Name
										{#if sortColumn === 'mapName'}
											<span class="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>
										{/if}
									</span>
								</th>
								<th class="sortable" on:click={() => handleSort('ownerEmail')}>
									<span class="th-content">
										Owner
										{#if sortColumn === 'ownerEmail'}
											<span class="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>
										{/if}
									</span>
								</th>
								<th class="sortable" on:click={() => handleSort('outputSizeBytes')} style="text-align: right;">
										Size
										{#if sortColumn === 'outputSizeBytes'}
											<span class="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>
										{/if}
								</th>
								<th class="sortable" on:click={() => handleSort('createdAt')} style="text-align: right;">
										Created
										{#if sortColumn === 'createdAt'}
											<span class="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>
										{/if}
								</th>
								<th class="sortable align-center" on:click={() => handleSort('jobStatus')} style="text-align: center;">
										Processed
										{#if sortColumn === 'jobStatus'}
											<span class="sort-arrow">{sortDirection === 'asc' ? '↑' : '↓'}</span>
										{/if}
								</th>
								<th class="align-center">Output</th>
								<th class="align-center">Actions</th>
							</tr>
						</thead>
						<tbody>
							{#each paginatedMaps as map}
								<tr class:expanded={expandedMapId === map.mapId}>
									<td class="checkbox-column">
										<input
											type="checkbox"
											checked={selectedMaps.has(map.mapId)}
											on:change={() => toggleMapSelection(map.mapId)}
											disabled={map.jobStatus !== 'COMPLETED'}
											title={map.jobStatus !== 'COMPLETED' ? 'Only completed maps can be downloaded' : 'Select for download'}
										/>
									</td>
									<td>
										<button class="map-name-button" on:click={() => toggleExpanded(map.mapId)} title="Click to view timing details">
											<strong class="map-name">{removeZipExtension(map.mapName)}</strong>
											<span class="expand-icon" class:rotated={expandedMapId === map.mapId}>
												<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
													<polyline points="6 9 12 15 18 9"></polyline>
												</svg>
											</span>
										</button>
									</td>
									<td>{map.ownerEmail}</td>
									<td class="align-right">{formatBytes(map.outputSizeBytes)}</td>
									<td class="align-right">{formatDate(map.createdAt)}</td>
									<td class="align-center">
										{#if map.jobStatus}
											<span class="status-badge status-{map.jobStatus.toLowerCase()}">
												{map.jobStatus}
											</span>
										{:else}
											<span class="status-badge status-unknown">Unknown</span>
										{/if}
									</td>
									<td class="align-center">
										{#if map.s3Output?.bucket && map.s3Output?.key}
											<button
												class="download-button"
												on:click={() => downloadFile(map)}
												disabled={downloadingMapId === map.mapId || map.jobStatus !== 'COMPLETED'}
											>
												{#if downloadingMapId === map.mapId}
													Downloading...
												{:else}
													Download
												{/if}
											</button>
										{:else}
											<span class="meta">—</span>
										{/if}
									</td>
									<td class="align-center">
										<div class="action-buttons">
											{#if user && map.ownerEmail === user.email}
												<button
													class="delete-button"
													on:click={() => deleteMap(map)}
													disabled={deletingMapId === map.mapId || map.jobStatus === 'PROCESSING' || map.jobStatus === 'DISPATCHED' || map.jobStatus === 'QUEUED'}
												>
													<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class:spinning={deletingMapId === map.mapId}>
														{#if deletingMapId === map.mapId}
															<path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
														{:else}
															<path d="M3 6h18"></path>
															<path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
															<path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
															<line x1="10" y1="11" x2="10" y2="17"></line>
															<line x1="14" y1="11" x2="14" y2="17"></line>
														{/if}
													</svg>
													<span class="delete-label">{deletingMapId === map.mapId ? 'Deleting...' : 'Delete'}</span>
												</button>

												{#if isRetryAvailable(map)}
													<button
														class="retry-button"
														on:click={() => retryMap(map)}
														disabled={retryingMapId === map.mapId}
													>
														<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class:spinning={retryingMapId === map.mapId}>
															<path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
														</svg>
														<span class="retry-label">{retryingMapId === map.mapId ? 'Retrying...' : 'Retry'}</span>
													</button>
												{/if}
											{/if}
										</div>
									</td>
								</tr>
								{#if expandedMapId === map.mapId}
									{@const metrics = getTimingMetrics(map)}
									<tr class="timing-row">
										<td colspan="8">
											<div class="timing-details">
												<h4>Processing Timeline</h4>
												{#if metrics.length > 0}
													<div class="timing-grid">
														{#each metrics as metric}
															<div class="timing-metric">
																<span class="timing-label">{metric.label}</span>
																<span class="timing-value">{metric.value}</span>
																<span class="timing-desc">{metric.description}</span>
															</div>
														{/each}
													</div>
												{:else}
													<p class="timing-empty">Timing data not yet available. Metrics are captured after processing begins.</p>
												{/if}
											</div>
										</td>
									</tr>
								{/if}
							{/each}
						</tbody>
					</table>
				</div>

				{#if totalPages > 1}
					<div class="pagination">
						<button
							class="pagination-button"
							on:click={prevPage}
							disabled={currentPage === 1}
						>
							Previous
						</button>

						<div class="page-numbers">
							{#each pageNumbers as pageNum}
								{#if pageNum === '...'}
									<span class="ellipsis">...</span>
								{:else}
										<button
											class="page-button"
											class:active={pageNum === currentPage}
											on:click={() => goToPage(pageNum as number)}
										>
										{pageNum}
									</button>
								{/if}
							{/each}
						</div>

						<button
							class="pagination-button"
							on:click={nextPage}
							disabled={currentPage === totalPages}
						>
							Next
						</button>
					</div>

					<p class="pagination-info">
						Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(
							currentPage * itemsPerPage,
							filteredMaps.length
						)} of {filteredMaps.length} map{filteredMaps.length === 1 ? '' : 's'}
					</p>
				{/if}
			{/if}
		</section>
	{/if}
</div>

<style>
	.layout {
		max-width: 1400px;
		margin: 0 auto;
		padding: 3rem 1.5rem 5rem;
		display: flex;
		flex-direction: column;
		gap: 2.5rem;
	}

	.top-bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.brand h1 {
		margin: 0;
		font-size: 2.25rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.brand p {
		margin: 0.4rem 0 0;
		color: var(--text-secondary);
		max-width: 40rem;
	}

	.auth-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	/* User Menu Styles */
	.user-menu-container {
		position: relative;
	}

	.user-menu-trigger {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 1rem;
		border-radius: 0.75rem;
		background: var(--chip-bg);
		color: var(--chip-text);
		border: 1px solid var(--button-ghost-border);
		cursor: pointer;
		font-weight: 500;
		font-size: 0.9rem;
		transition: background 0.2s ease, border-color 0.2s ease;
	}

	.user-menu-trigger:hover {
		background: var(--button-ghost-hover);
		border-color: var(--accent-primary);
	}

	.user-menu-trigger:focus-visible {
		outline: 3px solid var(--accent-soft);
		outline-offset: 2px;
	}

	.user-menu-trigger svg {
		width: 1.25rem;
		height: 1.25rem;
	}

	.chevron {
		display: inline-block;
		font-size: 0.75rem;
		transition: transform 0.2s ease;
		margin-left: 0.25rem;
	}

	.chevron.open {
		transform: rotate(180deg);
	}

	.menu-backdrop {
		position: fixed;
		inset: 0;
		background: transparent;
		z-index: 999;
	}

	.user-menu-dropdown {
		position: absolute;
		top: calc(100% + 0.5rem);
		right: 0;
		min-width: 240px;
		background: var(--background-surface);
		border: 1px solid var(--border-strong);
		border-radius: 0.75rem;
		box-shadow: var(--shadow-floating);
		z-index: 1000;
		overflow: hidden;
		animation: slideDown 0.2s ease;
	}

	@keyframes slideDown {
		from {
			opacity: 0;
			transform: translateY(-0.5rem);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.user-menu-header {
		padding: 1rem 1.25rem;
		background: var(--background-surface-muted);
	}

	.user-email {
		font-size: 0.9rem;
		font-weight: 500;
		color: var(--text-primary);
		word-break: break-all;
	}

	.user-menu-divider {
		height: 1px;
		background: var(--button-ghost-border);
		margin: 0;
	}

	.user-menu-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.9rem 1.25rem;
		color: var(--text-primary);
		text-decoration: none;
		cursor: pointer;
		transition: background 0.2s ease;
		font-size: 0.95rem;
	}

	.user-menu-item:hover {
		background: var(--button-ghost-hover);
	}

	.user-menu-item.logout {
		color: #dc2626;
		font-weight: 500;
	}

	.user-menu-item.logout:hover {
		background: rgba(220, 38, 38, 0.1);
	}

	.user-menu-item svg {
		width: 1.1rem;
		height: 1.1rem;
	}

	.menu-label {
		font-weight: 500;
	}

	.button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0.65rem 1.4rem;
		border-radius: 0.75rem;
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
		border: none;
		transition: transform 0.25s ease, box-shadow 0.25s ease, filter 0.25s ease, background 0.25s ease;
	}

	.button.primary {
		background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
		color: #ffffff;
		box-shadow: var(--shadow-floating);
	}

	.button.primary:hover {
		transform: translateY(-1px);
		filter: brightness(1.05);
	}

	.button.primary:focus-visible {
		outline: 3px solid var(--accent-soft);
		outline-offset: 2px;
	}

	.button.ghost {
		background: var(--button-ghost-bg);
		border: 1px solid var(--button-ghost-border);
		color: var(--button-ghost-text);
	}

	.button.ghost:hover {
		background: var(--button-ghost-hover);
	}

	.button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
		transform: none;
		box-shadow: none;
	}

	/* Hero section styles (Job pipeline overview) */
	.hero {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 320px);
		gap: 1.5rem;
		padding: 1.5rem 2rem;
		border-radius: 1.3rem;
		background: var(--hero-background);
		border: 1px solid var(--hero-border);
		box-shadow: var(--hero-shadow);
		backdrop-filter: blur(10px);
		position: relative;
		overflow: hidden;
	}

	.hero::after {
		content: '';
		position: absolute;
		inset: -40% 45% auto -20%;
		height: 280px;
		border-radius: 50%;
		background: radial-gradient(circle, rgba(124, 58, 237, 0.2), transparent 65%);
		pointer-events: none;
	}

	.hero-copy {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.hero h2 {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.hero p {
		margin: 0;
		color: var(--text-secondary);
		line-height: 1.5;
		font-size: 0.9rem;
	}

	.hero-stats {
		position: relative;
		z-index: 1;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
	}

	.stat-card {
		background: var(--panel-background);
		border-radius: 0.85rem;
		padding: 0.9rem 1rem;
		border: 1px solid var(--border-subtle);
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		box-shadow: var(--shadow-elevated);
	}

	.stat-card .label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
		min-height: 2em;
		display: flex;
		align-items: center;
	}

	.stat-card strong {
		font-size: 1.6rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.stat-card.caution {
		background: rgba(248, 113, 113, 0.12);
		border-color: rgba(248, 113, 113, 0.42);
	}

	.stat-card.caution strong {
		color: #b91c1c;
	}

	.stat-card.caution .label {
		color: rgba(185, 28, 28, 0.75);
	}

	.panel {
		background: var(--panel-background);
		border: 1px solid var(--panel-border);
		border-radius: 1.2rem;
		padding: 2rem;
		display: flex;
		flex-direction: column;
		gap: 1.75rem;
		box-shadow: var(--panel-shadow);
		backdrop-filter: blur(12px);
	}

	/* Landing Page Workflow Styles */
	.hero-landing {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3rem;
		padding: 3rem 2rem;
		border-radius: 1.3rem;
		background: var(--hero-background);
		border: 1px solid var(--hero-border);
		box-shadow: var(--hero-shadow);
		backdrop-filter: blur(10px);
		position: relative;
		overflow: hidden;
	}

	.hero-landing::after {
		content: '';
		position: absolute;
		inset: -40% 45% auto -20%;
		height: 280px;
		border-radius: 50%;
		background: radial-gradient(circle, rgba(124, 58, 237, 0.2), transparent 65%);
		pointer-events: none;
	}

	.hero-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100px;
		height: 100px;
		border-radius: 1.5rem;
		background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
		color: white;
		box-shadow: var(--shadow-floating);
	}

	.workflow-steps {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 1.5rem;
		flex-wrap: wrap;
	}

	.workflow-step {
		background: var(--panel-background);
		border: 1px solid rgba(124, 58, 237, 0.4);
		border-radius: 1rem;
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		box-shadow: var(--shadow-elevated);
		backdrop-filter: blur(12px);
		transition: transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease;
		min-width: 160px;
		position: relative;
	}

	.workflow-step:hover {
		transform: translateY(-4px);
		box-shadow: var(--shadow-floating);
		border-color: rgba(124, 58, 237, 0.7);
	}

	.step-number {
		position: absolute;
		top: -12px;
		right: -12px;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
		color: white;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		font-size: 0.9rem;
		box-shadow: var(--shadow-floating);
	}

	.step-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 64px;
		height: 64px;
		border-radius: 0.85rem;
		background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
		color: white;
		box-shadow: var(--shadow-floating);
	}

	.workflow-step h3 {
		margin: 0;
		font-size: 1.15rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.workflow-step p {
		margin: 0;
		color: var(--text-secondary);
		font-size: 0.85rem;
		text-align: center;
	}

	.workflow-arrow {
		color: var(--text-secondary);
		opacity: 0.5;
		display: flex;
		align-items: center;
	}

	.sign-in-button {
		margin-top: 1rem;
		padding: 0.85rem 2.5rem;
		font-size: 1.05rem;
		font-weight: 600;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		position: relative;
		z-index: 1;
	}

	.sign-in-button svg {
		width: 20px;
		height: 20px;
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1.5rem;
		flex-wrap: wrap;
	}

	.panel-header h2 {
		margin: 0;
		font-size: 1.6rem;
		font-weight: 700;
		color: var(--text-primary);
	}

	.panel-header .meta {
		margin-top: 0.25rem;
		color: var(--text-muted);
	}

	.search-box {
		flex: 1;
		max-width: 520px;
		min-width: 260px;
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.search-input {
		flex: 1;
		padding: 0.75rem 1rem;
		border-radius: 0.85rem;
		border: 1px solid var(--input-border);
		background: var(--input-background);
		color: var(--text-primary);
		font-size: 0.95rem;
		transition: border 0.2s ease, box-shadow 0.2s ease;
	}

	.search-input::placeholder {
		color: var(--input-placeholder);
	}

	.search-input:focus-visible {
		outline: none;
		border-color: var(--input-focus);
		box-shadow: 0 0 0 4px var(--accent-soft);
	}

	.table-wrapper {
		overflow-x: auto;
		border-radius: 1rem;
		border: 1px solid var(--table-border);
		background: var(--background-surface);
		box-shadow: var(--shadow-elevated);
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.92rem;
	}

	thead {
		background: var(--table-header-bg);
	}

	th,
	td {
		padding: 0.85rem 0.75rem;
	}

	th {
		font-weight: 700;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-secondary);
		text-align: left;
	}

	td {
		text-align: left;
	}

	th.align-right,
	td.align-right {
		text-align: right !important;
	}

	th.align-center,
	td.align-center {
		text-align: center !important;
	}

	th.align-center .th-content {
		display: flex !important;
		justify-content: center !important;
		width: 100% !important;
		align-items: center !important;
	}

	th.sortable {
		cursor: pointer;
		user-select: none;
		transition: background 0.2s ease, color 0.2s ease;
	}

	th.sortable:hover {
		background: var(--button-ghost-hover);
		color: var(--text-primary);
	}

	th.sortable:active {
		transform: scale(0.98);
	}

	.th-content {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}

	.sort-arrow {
		font-size: 0.9rem;
		color: var(--accent-primary);
		font-weight: 700;
		margin-left: 0.15rem;
	}

	td {
		color: var(--text-secondary);
		border-top: 1px solid var(--table-border);
	}

	tbody tr {
		transition: background 0.18s ease;
	}

	tbody tr:nth-child(even) {
		background: var(--table-row-alt-bg);
	}

	tbody tr:hover {
		background: var(--table-hover-bg);
	}

	.map-name {
		color: #7c3aed;
		font-weight: 600;
	}

	.meta {
		font-size: 0.85rem;
		color: var(--text-tertiary);
	}

	/* Checkbox column styles */
	.checkbox-column {
		width: 50px;
		text-align: center;
		padding: 0.85rem 0.5rem;
	}

	.checkbox-column input[type='checkbox'] {
		cursor: pointer;
		width: 18px;
		height: 18px;
		accent-color: #7c3aed;
	}

	.checkbox-column input[type='checkbox']:disabled {
		cursor: not-allowed;
		opacity: 0.4;
	}

	/* Download selected button */
	.download-selected-button {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.7rem 1rem;
		white-space: nowrap;
	}

	.download-selected-button svg {
		flex-shrink: 0;
	}

	.download-selected-button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.status-badge {
		display: inline-flex;
		align-items: center;
		padding: 0.3rem 0.65rem;
		border-radius: 999px;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.status-queued {
		background: rgba(59, 130, 246, 0.18);
		color: #1d4ed8;
	}

	.status-processing,
	.status-dispatched,
	.status-awaiting_output {
		background: rgba(34, 197, 94, 0.18);
		color: #15803d;
	}

	.status-completed {
		background: rgba(74, 222, 128, 0.18);
		color: #15803d;
	}

	.status-failed {
		background: rgba(248, 113, 113, 0.18);
		color: #b91c1c;
	}

	.status-unknown {
		background: rgba(148, 163, 184, 0.2);
		color: var(--text-secondary);
	}

	.action-buttons {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
	}

	.download-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.55rem 1.2rem;
		border-radius: 0.75rem;
		border: none;
		background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
		color: #ffffff;
		font-weight: 600;
		cursor: pointer;
		transition: transform 0.2s ease, filter 0.2s ease, box-shadow 0.2s ease;
		box-shadow: var(--shadow-floating);
	}

	.download-button:hover:not(:disabled) {
		transform: translateY(-1px);
		filter: brightness(1.05);
	}

	.download-button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
		box-shadow: none;
		transform: none;
	}

	.retry-button {
		display: inline-flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		padding: 0.35rem;
		background: transparent;
		border: none;
		color: #ea580c;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.retry-button:hover:not(:disabled) svg {
		transform: scale(1.1);
	}

	.retry-button:hover:not(:disabled) .retry-label {
		opacity: 1;
	}

	.retry-button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.retry-button svg {
		width: 16px;
		height: 16px;
		transition: transform 0.2s ease;
	}

	.retry-label {
		font-size: 0.7rem;
		font-weight: 600;
		opacity: 0;
		transition: opacity 0.2s ease;
	}

	.delete-button {
		display: inline-flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		padding: 0.35rem;
		background: transparent;
		border: none;
		color: #dc2626;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.delete-button:hover:not(:disabled) svg {
		transform: scale(1.1);
	}

	.delete-button:hover:not(:disabled) .delete-label {
		opacity: 1;
	}

	.delete-button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.delete-button svg {
		width: 20px;
		height: 20px;
		transition: transform 0.2s ease;
	}

	.delete-label {
		font-size: 0.7rem;
		font-weight: 600;
		opacity: 0;
		transition: opacity 0.2s ease;
	}

	.pagination {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 0.5rem;
		margin-top: 1rem;
		flex-wrap: wrap;
	}

	.pagination-button {
		padding: 0.6rem 1.2rem;
		border-radius: 0.75rem;
		border: 1px solid var(--button-ghost-border);
		background: var(--button-ghost-bg);
		color: var(--button-ghost-text);
		font-weight: 600;
		cursor: pointer;
		transition: background 0.2s ease, transform 0.2s ease;
	}

	.pagination-button:hover:not(:disabled) {
		background: var(--button-ghost-hover);
		transform: translateY(-1px);
	}

	.pagination-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		transform: none;
	}

	.page-numbers {
		display: flex;
		gap: 0.3rem;
		align-items: center;
	}

	.page-button {
		padding: 0.5rem 0.8rem;
		border-radius: 0.65rem;
		border: 1px solid var(--button-ghost-border);
		background: var(--background-surface);
		color: var(--text-secondary);
		font-weight: 600;
		cursor: pointer;
		transition: background 0.2s ease, transform 0.2s ease, border 0.2s ease;
		min-width: 2.5rem;
	}

	.page-button:hover {
		background: var(--accent-soft);
		border-color: var(--input-focus);
	}

	.page-button.active {
		background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
		color: #ffffff;
		border-color: transparent;
	}

	.ellipsis {
		padding: 0.5rem;
		color: var(--text-muted);
	}

	.pagination-info {
		text-align: center;
		margin: 0.75rem 0 0;
		color: var(--text-muted);
		font-size: 0.85rem;
	}

	.empty {
		color: var(--text-muted);
		font-style: italic;
		text-align: center;
		padding: 2rem;
	}

	@media (max-width: 1024px) {
		.table-wrapper {
			overflow-x: scroll;
		}

		table {
			min-width: 900px;
		}
	}

	@media (max-width: 880px) {
		.hero {
			grid-template-columns: 1fr;
		}

		.hero-stats {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 768px) {
		.layout {
			padding: 2.5rem 1.1rem 3.5rem;
			gap: 2rem;
		}

		.top-bar {
			flex-direction: column;
			align-items: flex-start;
		}

		.auth-actions {
			width: 100%;
			justify-content: flex-start;
		}

		.hero {
			padding: 2rem;
		}

		.hero-landing {
			padding: 2.5rem 1.5rem;
			gap: 2.5rem;
		}

		.hero-icon {
			width: 80px;
			height: 80px;
		}

		.hero-icon svg {
			width: 48px;
			height: 48px;
		}

		.workflow-steps {
			flex-direction: column;
			gap: 1rem;
		}

		.workflow-arrow {
			transform: rotate(90deg);
		}

		.hero-stats {
			grid-template-columns: 1fr;
		}

		.panel-header {
			flex-direction: column;
			align-items: stretch;
		}

		.search-box {
			max-width: 100%;
		}

		.pagination {
			flex-direction: column;
		}

		.page-numbers {
			order: 3;
			justify-content: center;
		}
	}

	/* Refresh button styles */
	.refresh-button {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.7rem 1rem;
		white-space: nowrap;
	}

	.refresh-button svg {
		flex-shrink: 0;
	}

	.refresh-button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	/* Spinning animation for refresh icon */
	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	.spinning {
		animation: spin 1s linear infinite;
	}

	/* Map name button for expanding timing details */
	.map-name-button {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		text-align: left;
		color: inherit;
	}

	.map-name-button:hover .map-name {
		text-decoration: underline;
	}

	.expand-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
		transition: transform 0.2s ease;
	}

	.expand-icon.rotated {
		transform: rotate(180deg);
	}

	/* Expanded row styling */
	tr.expanded {
		background: var(--accent-soft) !important;
	}

	/* Timing row */
	.timing-row {
		background: var(--background-surface-muted) !important;
	}

	.timing-row td {
		padding: 0 !important;
		border-top: none !important;
	}

	.timing-details {
		padding: 1rem 1.5rem;
		border-top: 1px dashed var(--border-subtle);
	}

	.timing-details h4 {
		margin: 0 0 0.75rem;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-primary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.timing-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 1rem;
	}

	.timing-metric {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.75rem;
		background: var(--background-surface);
		border-radius: 0.5rem;
		border: 1px solid var(--border-subtle);
	}

	.timing-label {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
	}

	.timing-value {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--accent-primary);
	}

	.timing-desc {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	.timing-empty {
		color: var(--text-muted);
		font-size: 0.85rem;
		font-style: italic;
		margin: 0;
	}

	.task-arn {
		margin: 0.75rem 0 0;
		font-size: 0.75rem;
		color: var(--text-tertiary);
		font-family: monospace;
	}
</style>
