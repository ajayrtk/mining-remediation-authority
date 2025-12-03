<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/stores';
	import { invalidateAll } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { ActionData, PageData } from './$types';
	import type { JobSummary } from './+page.server';
	import { validateZipFiles, allValid, type ValidationResult } from '$lib/utils/zipValidator';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';

	export let data: PageData;

	const MAX_FILES = 10;
	const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB (matches backend BODY_SIZE_LIMIT)

	let selectedFiles: File[] = [];
	let isSubmitting = false;
	let isValidating = false;
	let jobs: JobSummary[] = [];
	let isRefreshing = false;
	let user: PageData['user'] = data.user;

	type UploadStatus = 'pending' | 'validating' | 'validating-georef' | 'valid' | 'invalid' | 'uploading' | 'done' | 'error';

	type UploadFormState = ActionData & {
		error?: string;
		uploaded?: { name: string; key: string }[];
	};

	type UploadProgress = {
		name: string;
		status: UploadStatus;
		error?: string;
		imagesFound?: string[];
	};

	let uploadProgress: UploadProgress[] = [];
	let validationResults: ValidationResult[] = [];
	let formState: UploadFormState | null = null;

	// Track backend validation errors separately (duplicate detection, etc.)
	// Key: filename, Value: error message
	let backendValidationErrors: Map<string, string> = new Map();

	// Auto-refresh configuration
	const AUTO_REFRESH_INTERVAL = 10000; // 10 seconds
	let autoRefreshInterval: ReturnType<typeof setInterval> | null = null;

	// Pagination state
	let currentPage = 1;
	const itemsPerPage = 10;

	// User menu state
	let isUserMenuOpen = false;

	const toggleUserMenu = () => {
		isUserMenuOpen = !isUserMenuOpen;
	};

	const closeUserMenu = () => {
		isUserMenuOpen = false;
	};

	$: formState = ($page.form as UploadFormState | null) ?? null;
	$: jobs = (data.jobs ?? []) as JobSummary[];
	$: user = data.user;
	$: if (!user) {
		selectedFiles = [];
		uploadProgress = [];
		validationResults = [];
		backendValidationErrors = new Map();
	}
	// Check if all files are valid (client-side validation, georeferencing validation, and no backend errors)
	// Block submission if any file has 'invalid' or 'error' status (includes duplicates, validation failures, etc.)
	$: allFilesValid = validationResults.length > 0 && allValid(validationResults) && backendValidationErrors.size === 0 && !uploadProgress.some(p => p.status === 'invalid' || p.status === 'error');

	// Check if any files have already been uploaded or have backend errors
	$: hasUploadedOrErrorFiles = uploadProgress.some((p) => p.status === 'done' || p.status === 'error');

	// Calculate job statistics for dashboard based on actual map statuses
	const inProgressStatuses = ['QUEUED', 'DISPATCHED', 'PROCESSING', 'AWAITING_OUTPUT'];
	const completedStatuses = ['COMPLETED'];
	const failedStatuses = ['FAILED'];

	$: stats = {
		total: jobs.length,
		// Count maps that are in progress across all jobs
		active: jobs.reduce((count, job) => {
			const inProgressMaps = (job.mapStatuses ?? []).filter(status => inProgressStatuses.includes(status)).length;
			return count + (inProgressMaps > 0 ? 1 : 0);
		}, 0),
		// Count jobs where all maps are completed
		completed: jobs.filter((job) => {
			const allMapsCompleted = job.mapStatuses && job.mapStatuses.length > 0 &&
				job.mapStatuses.every(status => completedStatuses.includes(status));
			return allMapsCompleted;
		}).length,
		// Count jobs where any map failed
		failed: jobs.filter((job) => {
			const anyMapFailed = job.mapStatuses && job.mapStatuses.some(status => failedStatuses.includes(status));
			return anyMapFailed;
		}).length
	};

	// Pagination
	$: totalPages = Math.ceil(jobs.length / itemsPerPage);
	$: paginatedJobs = jobs.slice(
		(currentPage - 1) * itemsPerPage,
		currentPage * itemsPerPage
	);

	const nextPage = () => {
		if (currentPage < totalPages) currentPage += 1;
	};

	const prevPage = () => {
		if (currentPage > 1) currentPage -= 1;
	};

	const goToPage = (page: number) => {
		if (page >= 1 && page <= totalPages) currentPage = page;
	};

	// Generate smart pagination with ellipsis
	$: pageNumbers = (() => {
		const delta = 2;
		const range = [];
		const rangeWithDots = [];
		let l: number | undefined;

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

	const formatDate = (value?: string | null) => (value ? new Date(value).toLocaleString() : '—');
	const statusClass = (status: string) => `status-${status.toLowerCase()}`;
	const removeZipExtension = (filename: string) => filename.replace(/\.zip$/i, '');

	// Compute job status from map statuses
	const getJobStatus = (job: JobSummary): string => {
		const mapStatuses = job.mapStatuses ?? [];

		// If no map statuses available, fall back to job status
		if (mapStatuses.length === 0) {
			return job.status;
		}

		const hasCompleted = mapStatuses.some(s => s === 'COMPLETED');
		const hasFailed = mapStatuses.some(s => s === 'FAILED');
		const hasProcessing = mapStatuses.some(s => ['PROCESSING', 'AWAITING_OUTPUT'].includes(s));
		const hasDispatched = mapStatuses.some(s => s === 'DISPATCHED');
		const hasQueued = mapStatuses.some(s => s === 'QUEUED');
		const allCompleted = mapStatuses.every(s => s === 'COMPLETED');
		const allFailed = mapStatuses.every(s => s === 'FAILED');

		// Determine overall status (ordered by progression: QUEUED → DISPATCHED → PROCESSING → COMPLETED)
		if (allCompleted) return 'COMPLETED';
		if (allFailed) return 'FAILED';
		if (hasFailed && hasCompleted) return 'PARTIAL_SUCCESS';
		if (hasFailed) return 'FAILED';
		if (hasProcessing) return 'PROCESSING';
		if (hasDispatched) return 'DISPATCHED';
		if (hasQueued) return 'QUEUED';

		// Fallback to job status
		return job.status;
	};

	// Handle file selection and validation
	const onFileSelection = async (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;

		if (!input.files || input.files.length === 0) {
			uploadProgress = [];
			validationResults = [];
			return;
		}

		// Limit to MAX_FILES
		const newFiles = Array.from(input.files).slice(0, MAX_FILES);

		// Add new files to existing selection (up to MAX_FILES total)
		const remainingSlots = MAX_FILES - selectedFiles.length;
		const filesToAdd = newFiles.slice(0, remainingSlots);

		if (filesToAdd.length === 0) {
			alert(`You can only select up to ${MAX_FILES} files. Remove some files before adding more.`);
			input.value = ''; // Reset input
			return;
		}

		// Check file sizes (200MB limit matches backend BODY_SIZE_LIMIT)
		const oversizedFiles = filesToAdd.filter(file => file.size > MAX_FILE_SIZE);
		if (oversizedFiles.length > 0) {
			const formatBytes = (bytes: number) => {
				if (bytes === 0) return '0 Bytes';
				const k = 1024;
				const sizes = ['Bytes', 'KB', 'MB', 'GB'];
				const i = Math.floor(Math.log(bytes) / Math.log(k));
				return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
			};

			const fileList = oversizedFiles
				.map(f => `• ${f.name} (${formatBytes(f.size)})`)
				.join('\n');

			alert(`The following files exceed the 200MB size limit and cannot be uploaded:\n\n${fileList}\n\nPlease compress the files or reduce their size.`);
			input.value = ''; // Reset input
			return;
		}

		selectedFiles = [...selectedFiles, ...filesToAdd];
		input.value = ''; // Reset input so same file can be selected again

		uploadProgress = selectedFiles.map((file) => ({
			name: file.name,
			status: 'validating' as UploadStatus
		}));

		isValidating = true;
		try {
			// Step 1: Client-side JSZip validation (filename format, ZIP structure)
			validationResults = await validateZipFiles(selectedFiles);
			uploadProgress = validationResults.map((result) => ({
				name: result.fileName,
				status: result.valid ? 'validating-georef' : 'invalid',
				error: result.error,
				imagesFound: result.imagesFound
			}));

			// Step 2: Backend georeferencing validation for files that passed client-side validation
			const filesToValidateGeoref = selectedFiles.filter((file, index) => validationResults[index].valid);

			if (filesToValidateGeoref.length > 0) {

				// Validate files sequentially to avoid overwhelming the server
				for (let i = 0; i < filesToValidateGeoref.length; i++) {
					const file = filesToValidateGeoref[i];
					const progressIndex = uploadProgress.findIndex(p => p.name === file.name);

					if (progressIndex === -1) continue;

					try {
						const formData = new FormData();
						formData.append('file', file);

						const response = await fetch('/api/validate-map', {
							method: 'POST',
							body: formData
						});

						const result = await response.json();

						if (!response.ok || result.error) {
							// Georeferencing validation failed
							uploadProgress[progressIndex] = {
								...uploadProgress[progressIndex],
								status: 'invalid',
								error: result.error || result.message || result.details || 'Georeferencing validation failed'
							};
						} else {
							// All validations passed
							uploadProgress[progressIndex] = {
								...uploadProgress[progressIndex],
								status: 'valid'
							};
						}
					} catch (error) {
						console.error(`[Frontend] Georef validation error for ${file.name}:`, error);
						uploadProgress[progressIndex] = {
							...uploadProgress[progressIndex],
							status: 'invalid',
							error: error instanceof Error ? error.message : 'Failed to validate georeferencing'
						};
					}

					// Trigger reactivity
					uploadProgress = [...uploadProgress];
				}
			}

			// Step 3: Client-side duplicate detection within the batch
			const validFilesForDupeCheck = selectedFiles.filter((_, index) => {
				const progress = uploadProgress.find(p => p.name === selectedFiles[index].name);
				return progress && progress.status === 'valid';
			});

			if (validFilesForDupeCheck.length > 1) {
				// Compute hashes for all valid files and detect duplicates
				const fileHashes: Map<string, string[]> = new Map(); // hash -> [filenames]

				for (const file of validFilesForDupeCheck) {
					const hash = await calculateFileHash(file);
					const existing = fileHashes.get(hash) || [];
					existing.push(file.name);
					fileHashes.set(hash, existing);
				}

				// Mark duplicates as invalid (keep only the first file with each hash)
				for (const [, fileNames] of fileHashes) {
					if (fileNames.length > 1) {
						// Skip the first file (it's valid), mark the rest as duplicates
						for (let i = 1; i < fileNames.length; i++) {
							const progressIndex = uploadProgress.findIndex(p => p.name === fileNames[i]);
							if (progressIndex !== -1) {
								uploadProgress[progressIndex] = {
									...uploadProgress[progressIndex],
									status: 'invalid',
									error: `Duplicate content: This file contains the same image as "${fileNames[0]}"`
								};
							}
						}
					}
				}
				uploadProgress = [...uploadProgress];
			}
		} catch (error) {
			console.error('Validation error:', error);
			const errorMessage = error instanceof Error
				? `Validation failed: ${error.message}`
				: 'Failed to validate file - please check file format and try again';
			uploadProgress = uploadProgress.map((p) => ({
				...p,
				status: 'invalid',
				error: errorMessage
			}));
		} finally {
			isValidating = false;
		}
	};

	// Remove a file from the selection
	const removeFile = (fileName: string) => {
		// Remove from selectedFiles
		selectedFiles = selectedFiles.filter(file => file.name !== fileName);

		// Remove from uploadProgress (preserve validation state for other files)
		uploadProgress = uploadProgress.filter(p => p.name !== fileName);

		// Remove from validationResults (preserve validation state for other files)
		validationResults = validationResults.filter(r => r.fileName !== fileName);

		// Remove backend validation error for this file
		backendValidationErrors.delete(fileName);
		backendValidationErrors = new Map(backendValidationErrors); // Trigger reactivity

		// If no files remaining, clear all state
		if (selectedFiles.length === 0) {
			uploadProgress = [];
			validationResults = [];
			backendValidationErrors = new Map();
		}
	};

	// Calculate SHA-256 hash of file for deduplication
	// For ZIP files, hash the image content inside, not the ZIP itself
	const calculateFileHash = async (file: File): Promise<string> => {
		// For ZIP files, extract and hash the image content inside
		if (file.name.toLowerCase().endsWith('.zip')) {
			const JSZip = (await import('jszip')).default;
			const zip = await JSZip.loadAsync(file);

			// Find the image file inside the ZIP
			let imageContent: ArrayBuffer | null = null;
			for (const [path, zipEntry] of Object.entries(zip.files)) {
				if (zipEntry.dir) continue;
				const fileName = path.split('/').pop() || path;
				if (fileName.startsWith('.')) continue;

				const lower = fileName.toLowerCase();
				if (lower.endsWith('.jpg') || lower.endsWith('.jpeg') ||
					lower.endsWith('.tif') || lower.endsWith('.tiff')) {
					imageContent = await zipEntry.async('arraybuffer');
					break; // Use first image found
				}
			}

			if (imageContent) {
				const hashBuffer = await crypto.subtle.digest('SHA-256', imageContent);
				const hashArray = Array.from(new Uint8Array(hashBuffer));
				const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
				return hashHex.substring(0, 12);
			}
		}

		// Fallback: hash the entire file
		const buffer = await file.arrayBuffer();
		const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
		return hashHex.substring(0, 12);
	};

	// Handle form submission and file upload
	const handleSubmit: SubmitFunction = async ({ cancel }) => {
		cancel();

		if (selectedFiles.length === 0 || selectedFiles.length > MAX_FILES || !allFilesValid) {
			return;
		}

		isSubmitting = true;

		try {

			// Files are already validated client-side, proceed to upload
			// Filter out files with errors or invalid status
			const validFiles = selectedFiles.filter((file) => {
				const progress = uploadProgress.find(p => p.name === file.name);
				return progress && progress.status === 'valid' && !backendValidationErrors.has(file.name);
			});

			// Step 2: Get presigned URLs only for valid files
			const fileRequests = await Promise.all(
				validFiles.map(async (file) => ({
					name: file.name,
					size: file.size,
					type: file.type,
					hash: await calculateFileHash(file)
				}))
			);


			const response = await fetch('/api/presigned-url', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ files: fileRequests })
			});


			if (!response.ok) {
				const errorData = await response.json();

				// Special handling for authentication errors
				if (response.status === 401) {
					alert('Your session has expired. Please refresh the page and sign in again.');
					uploadProgress = uploadProgress.map((entry) => ({
						...entry,
						status: 'error',
						error: errorData.error || 'Session expired'
					}));
					return;
				}

				// Check if we have per-file errors
				if (errorData.fileErrors && Array.isArray(errorData.fileErrors)) {

					// Store backend errors in separate Map to preserve them across re-validation
					errorData.fileErrors.forEach((fileError: any) => {
						backendValidationErrors.set(fileError.fileName, fileError.error);
					});
					backendValidationErrors = new Map(backendValidationErrors); // Trigger reactivity

					// Only mark files as error if they're actually in the fileErrors array
					uploadProgress = uploadProgress.map((entry) => {
						const fileError = errorData.fileErrors.find((e: any) => e.fileName === entry.name);

						// Only mark as error if this file actually has an error
						if (fileError) {
							return {
								...entry,
								status: 'error',
								error: fileError.error
							};
						}

						// Keep the current status for files that passed validation
						return entry;
					});
				} else {
					// Fallback: mark all files as error
					uploadProgress = uploadProgress.map((entry) => ({
						...entry,
						status: 'error',
						error: errorData.error || 'Failed to get upload URLs'
					}));
				}
				// Don't throw - just return early since we've already set the error states
				return;
			}

			const responseData = await response.json();
			const { urls, fileErrors: mixedErrors } = responseData;

			// If response contains fileErrors, mark those files as error
			if (mixedErrors && Array.isArray(mixedErrors)) {

				// Store backend errors in separate Map to preserve them across re-validation
				mixedErrors.forEach((fileError: any) => {
					backendValidationErrors.set(fileError.fileName, fileError.error);
				});
				backendValidationErrors = new Map(backendValidationErrors); // Trigger reactivity

				uploadProgress = uploadProgress.map((entry) => {
					const fileError = mixedErrors.find((e: any) => e.fileName === entry.name);
					if (fileError) {
						return {
							...entry,
							status: 'error',
							error: fileError.error
						};
					}
					return entry;
				});
			}

			// Upload files that have URLs (passed validation)
			if (urls && urls.length > 0) {
				for (const urlData of urls) {
					// Find the file by matching the key (sanitized name) to original file
					const file = validFiles.find(f => {
						// The urlData.key is the sanitized filename, need to match to original
						return urlData.metadata.originalFilename === f.name;
					});

					if (!file) {
						console.error(`Could not find file for URL data:`, urlData);
						continue;
					}

					try {
						// Set upload timeout to 10 minutes (600000ms)
						// This prevents indefinite hangs for large files on slow connections
						const uploadTimeout = 10 * 60 * 1000;
						const abortController = new AbortController();
						const timeoutId = setTimeout(() => abortController.abort(), uploadTimeout);

						try {
							const uploadResponse = await fetch(urlData.url, {
								method: 'PUT',
								body: file,
								headers: {
									'Content-Type': file.type
								},
								signal: abortController.signal
							});

							clearTimeout(timeoutId);

							if (!uploadResponse.ok) {
								throw new Error(`Failed to upload ${file.name}`);
							}

							// Update the specific file's status
							uploadProgress = uploadProgress.map((entry) =>
								entry.name === file.name ? { ...entry, status: 'done' } : entry
							);
						} catch (fetchError) {
							clearTimeout(timeoutId);

							// Check if error was due to timeout/abort
							if (fetchError instanceof Error && fetchError.name === 'AbortError') {
								throw new Error(`Upload timeout after ${uploadTimeout / 1000} seconds - file too large or connection too slow`);
							}

							throw fetchError;
						}
					} catch (error) {
						console.error(`Upload failed for ${file.name}:`, error);
						uploadProgress = uploadProgress.map((entry) =>
							entry.name === file.name
								? {
										...entry,
										status: 'error',
										error: error instanceof Error ? error.message : 'Upload failed'
								  }
								: entry
						);
					}
				}
			}

			const allSuccess = uploadProgress.every((p) => p.status === 'done');
			if (allSuccess) {
				await invalidateAll();
				selectedFiles = [];
				uploadProgress = [];
				validationResults = [];
				backendValidationErrors = new Map(); // Clear backend errors on successful upload

				// Auto-refresh recent activity after 2 seconds
				setTimeout(async () => {
					await invalidateAll();
				}, 2000);
			}
		} catch (error) {
			console.error('Upload error:', error);
			uploadProgress = uploadProgress.map((entry) => ({
				...entry,
				status: 'error',
				error: error instanceof Error ? error.message : 'Upload failed'
			}));
		} finally {
			isSubmitting = false;
		}
	};

	const refreshJobs = async () => {
		try {
			isRefreshing = true;
			await invalidateAll();
		} finally {
			isRefreshing = false;
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
				<a class="button ghost" href="/maps">View All Maps</a>

				<!-- User Menu -->
				<div class="user-menu-container">
					<button class="user-menu-trigger" on:click={toggleUserMenu}>
						<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
							<circle cx="12" cy="7" r="4"></circle>
						</svg>
						<span class="chevron" class:open={isUserMenuOpen}>▼</span>
					</button>

					{#if isUserMenuOpen}
						<!-- svelte-ignore a11y-click-events-have-key-events -->
						<!-- svelte-ignore a11y-no-static-element-interactions -->
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
								<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
									<polyline points="16 17 21 12 16 7"></polyline>
									<line x1="21" y1="12" x2="9" y2="12"></line>
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

	{#if user}
		<section class="hero">
			<div class="hero-copy">
				<h2>Job pipeline overview</h2>
				<p>
					Each upload goes through automated validation, processing, and completion.<br />Track system performance and job reliability using the live counters.
				</p>
			</div>
			<div class="hero-stats">
				<div class="stat-card">
					<span class="label">Jobs submitted</span>
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
	{:else}
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
	{/if}

	{#if user}
		<section class="grid">
			<article class="panel upload-panel">
				<header>
					<h3>Upload your map data archives</h3>
					<p>Drag and drop your ZIP files or select them manually to start new map jobs.<br/></p>
				</header>
				<form method="post" enctype="multipart/form-data" use:enhance={handleSubmit}>
					<label class="file-input">
						<span>Select files (max {MAX_FILES})</span>
						<input
							type="file"
							name="files"
							accept=".zip"
							multiple
							on:change={onFileSelection}
						/>
					</label>

					{#if selectedFiles.length > 0}
						<p class:selected-warning={selectedFiles.length > MAX_FILES}>
							{selectedFiles.length} / {MAX_FILES} file{selectedFiles.length === 1 ? '' : 's'} selected.
							{#if selectedFiles.length >= MAX_FILES}
								<span class="limit-reached">Maximum limit reached.</span>
							{/if}
						</p>
					{/if}

					{#if uploadProgress.length > 0}
						<ul class="upload-progress" aria-live="polite">
							{#each uploadProgress as item}
								<li class={`upload-${item.status}`}>
									<div class="progress-content">
										<span class="file-name">{item.name}</span>
										{#if item.imagesFound && item.imagesFound.length > 0 && item.status === 'valid'}
											<span class="image-info">
												Contains: {item.imagesFound[0]}
												{#if item.imagesFound.length > 1}
													+{item.imagesFound.length - 1} more
												{/if}
											</span>
										{/if}
										{#if item.error && item.status === 'invalid'}
											<span class="error-info">{item.error}</span>
										{:else if item.error && item.status === 'error'}
											<span class="info-message">{item.error}</span>
										{/if}
									</div>
									<div class="file-actions">
										<span class="status-label">
											{#if item.status === 'pending'}
												Queued
											{:else if item.status === 'validating'}
												<span class="validating">Validating format…</span>
											{:else if item.status === 'validating-georef'}
												<span class="validating">Checking coordinates…</span>
											{:else if item.status === 'valid'}
												✓ Valid
											{:else if item.status === 'invalid'}
												Invalid
											{:else if item.status === 'uploading'}
												Uploading…
											{:else if item.status === 'done'}
												Uploaded
											{:else if item.status === 'error'}
												Duplicate
											{:else}
												Failed
											{/if}
										</span>
										{#if item.status !== 'uploading' && item.status !== 'done'}
											<button
												type="button"
												class="remove-file-btn"
												on:click={() => removeFile(item.name)}
												disabled={isSubmitting || isValidating}
												title="Remove file"
											>
												<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
													<line x1="18" y1="6" x2="6" y2="18"></line>
													<line x1="6" y1="6" x2="18" y2="18"></line>
												</svg>
											</button>
										{/if}
									</div>
								</li>
							{/each}
						</ul>
					{/if}

					<button
						type="submit"
						disabled={isSubmitting || isValidating || selectedFiles.length === 0 || selectedFiles.length > MAX_FILES || !allFilesValid || hasUploadedOrErrorFiles}
					>
						{#if isSubmitting}
							Uploading…
						{:else if isValidating}
							Validating…
						{:else}
							Submit Maps
						{/if}
					</button>

				</form>

				{#if formState?.error}
					<p class="error">{formState.error}</p>
				{/if}

				{#if formState?.uploaded && formState.uploaded.length > 0}
					<section class="results">
						<h4>Queued jobs</h4>
						<ul>
							{#each formState.uploaded as job}
								<li>
									<strong>{job.name}</strong>
									<code>{job.key}</code>
								</li>
							{/each}
						</ul>
					</section>
				{/if}
			</article>

			<article class="panel history-panel">
				<header class="history-header">
					<div>
						<h3>Recent job activity</h3>
						<p>Monitor your latest uploads in real time.<br/></p>
					</div>
					<button type="button" class="button ghost refresh-button" on:click={refreshJobs} disabled={isRefreshing} title="Refresh job activity">
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
						{#if isRefreshing}
							Refreshing…
						{:else}
							Refresh
						{/if}
					</button>
				</header>
				{#if jobs.length === 0}
					<p class="empty">No jobs have been submitted yet.</p>
				{:else}
					<div class="table-wrapper">
						<table>
							<thead>
								<tr>
									<th>Map Names</th>
									<th>Source</th>
									<th>Status</th>
									<th>Created</th>
								</tr>
							</thead>
							<tbody>
								{#each paginatedJobs as job}
									<tr>
										<td>
											{#if job.mapNames && job.mapNames.length > 0}
												<div class="map-names">
													{#each job.mapNames as mapName, i}
														<span class="map-name">{removeZipExtension(mapName)}</span>{#if i < job.mapNames.length - 1}, {/if}
													{/each}
												</div>
											{:else}
												<span class="meta">—</span>
											{/if}
										</td>
										<td>
											{#if job.batchSize}
												<strong>{job.batchSize} file{job.batchSize > 1 ? 's' : ''}</strong>
												<div class="meta">Processed: {job.processedCount ?? 0}/{job.batchSize}</div>
											{:else}
												<span class="meta">—</span>
											{/if}
										</td>
										<td>
											<span class={`status-badge ${statusClass(getJobStatus(job))}`}>{getJobStatus(job)}</span>
										</td>
										<td>{formatDate(job.createdAt)}</td>
									</tr>
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
								jobs.length
							)} of {jobs.length} job{jobs.length === 1 ? '' : 's'}
						</p>
					{/if}
				{/if}
			</article>
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
		max-width: 34rem;
	}

	.auth-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.user-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.4rem 0.85rem;
		border-radius: 999px;
		background: var(--chip-bg);
		color: var(--chip-text);
		font-size: 0.9rem;
		font-weight: 500;
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

	/* New Landing Page Styles */
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

	.sign-in-panel {
		align-items: flex-start;
		gap: 1.2rem;
	}

	.panel header h3 {
		margin: 0;
		font-size: 1.35rem;
		color: var(--text-primary);
	}

	.panel header p {
		margin: 0.35rem 0 0;
		color: var(--text-secondary);
		line-height: 1.6;
	}

	.grid {
		display: grid;
		grid-template-columns: minmax(0, 0.75fr) minmax(0, 1.25fr);
		gap: 1.75rem;
		align-items: flex-start;
	}

	.panel.upload-panel {
		position: relative;
		overflow: hidden;

	}

	.panel.upload-panel::after {
		content: '';
		position: absolute;
		inset: auto -30% -35% auto;
		width: 300px;
		height: 300px;
		background: radial-gradient(circle, rgba(37, 99, 235, 0.18), transparent 70%);
		opacity: 0.6;
		pointer-events: none;
	}

	.file-input {
		display: inline-flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.85rem 1.25rem;
		border-radius: 0.85rem;
		border: 1px dashed var(--border-strong);
		background: var(--background-surface);
		color: var(--text-secondary);
		font-weight: 600;
		cursor: pointer;
		transition: border 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
	}

	.file-input:hover {
		border-color: var(--accent-primary);
		box-shadow: var(--shadow-floating);
		transform: translateY(-1px);
	}

	.file-input span {
		pointer-events: none;
	}

	.file-input input {
		display: none;
	}

	.selected-warning {
		color: #c2410c;
		font-weight: 600;
	}

	.limit-reached {
		display: inline-block;
		margin-left: 0.5rem;
		padding: 0.25rem 0.6rem;
		background: rgba(194, 65, 12, 0.1);
		border-radius: 0.5rem;
		font-size: 0.85rem;
		font-weight: 600;
	}

	.upload-progress {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.upload-progress li {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		padding: 0.9rem 1rem 0.9rem 1.4rem;
		border-radius: 0.9rem;
		border: 1px solid var(--border-subtle);
		background: var(--background-surface);
		box-shadow: var(--shadow-elevated);
		position: relative;
		overflow: hidden;
	}

	.upload-progress li::before {
		content: '';
		position: absolute;
		inset: 0 auto 0 0;
		width: 6px;
		background: var(--accent-primary);
		opacity: 0.85;
	}

	.upload-progress li .progress-content {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		flex: 1;
		min-width: 0;
	}

	.file-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
		color: var(--text-primary);
	}

	.image-info {
		font-size: 0.78rem;
		color: var(--text-secondary);
		opacity: 0.75;
	}

	.error-info {
		font-size: 0.78rem;
		color: #dc2626;
		font-weight: 600;
	}

	.info-message {
		font-size: 0.78rem;
		color: #2563eb;
		font-weight: 600;
	}

	.file-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.status-label {
		font-weight: 600;
		white-space: nowrap;
		color: var(--text-secondary);
	}

	.remove-file-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.4rem;
		border: none;
		background: rgba(220, 38, 38, 0.1);
		color: #dc2626;
		border-radius: 0.5rem;
		cursor: pointer;
		transition: all 0.2s ease;
		flex-shrink: 0;
	}

	.remove-file-btn:hover:not(:disabled) {
		background: rgba(220, 38, 38, 0.2);
		transform: scale(1.05);
	}

	.remove-file-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.remove-file-btn svg {
		display: block;
	}

	.upload-invalid::before {
		background: rgba(248, 113, 113, 0.9);
	}

	.upload-error::before {
		background: rgba(59, 130, 246, 0.85);
	}

	.upload-valid::before,
	.upload-done::before {
		background: rgba(34, 197, 94, 0.85);
	}

	.upload-validating::before,
	.upload-uploading::before {
		background: rgba(59, 130, 246, 0.85);
	}

	.upload-pending::before {
		background: rgba(234, 179, 8, 0.85);
	}

	.upload-invalid .status-label {
		color: #b91c1c;
	}

	.upload-error .status-label {
		color: #2563eb;
	}

	.upload-valid .status-label,
	.upload-done .status-label {
		color: #15803d;
	}

	.upload-validating .status-label,
	.upload-uploading .status-label {
		color: #2563eb;
	}

	.upload-pending .status-label {
		color: #c2410c;
	}

	.validating {
		animation: pulse 1.4s ease-in-out infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}

		50% {
			opacity: 0.5;
		}
	}

	form button[type='submit'] {
		background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
		color: #ffffff;
		border: none;
		border-radius: 0.85rem;
		padding: 0.75rem 1.6rem;
		font-weight: 600;
		cursor: pointer;
		transition: transform 0.2s ease, filter 0.2s ease, box-shadow 0.2s ease;
		box-shadow: var(--shadow-floating);
		margin-top: 0.75rem;
	}

	form button[type='submit']:hover:not(:disabled) {
		transform: translateY(-1px);
		filter: brightness(1.04);
	}

	form button[type='submit']:disabled {
		opacity: 0.55;
		cursor: not-allowed;
		box-shadow: none;
		transform: none;
	}

	.validation-warning {
		margin: 0;
		padding: 0.85rem 1rem;
		border-radius: 0.8rem;
		background: rgba(251, 191, 36, 0.15);
		border: 1px solid rgba(251, 191, 36, 0.4);
		color: #92400e;
		font-weight: 600;
	}

	.results ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}

	.results li {
		background: var(--background-surface);
		border-radius: 0.8rem;
		padding: 0.85rem 1rem;
		border: 1px solid var(--border-subtle);
		box-shadow: var(--shadow-elevated);
	}

	.results code {
		display: block;
		margin-top: 0.35rem;
		font-size: 0.82rem;
		color: var(--text-secondary);
		opacity: 0.75;
	}

	.error {
		margin: 0;
		padding: 0.8rem 1rem;
		border-radius: 0.8rem;
		background: rgba(248, 113, 113, 0.15);
		border: 1px solid rgba(248, 113, 113, 0.4);
		color: #b91c1c;
		font-weight: 600;
	}

	.history-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1.5rem;
		flex-wrap: wrap;
	}

	.history-header h3 {
		margin: 0;
		font-size: 1.35rem;
		color: var(--text-primary);
	}

	.history-header p {
		margin: 0.35rem 0 0;
		color: var(--text-secondary);
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
		font-size: 0.95rem;
	}

	thead {
		background: var(--table-header-bg);
	}

	th,
	td {
		padding: 0.85rem;
		text-align: left;
	}

	th {
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-secondary);
	}

	/* Align Status column header and content to center */
	th:nth-child(3),
	td:nth-child(3) {
		text-align: center;
	}

	/* Align Created column - keep left aligned */
	th:nth-child(4),
	td:nth-child(4) {
		text-align: left;
	}

	td {
		color: var(--text-secondary);
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

	code {
		font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
		font-size: 0.82rem;
	}

	.map-names {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.map-name {
		color: #7c3aed;
		font-weight: 600;
	}

	.meta {
		font-size: 0.82rem;
		color: var(--text-tertiary);
	}

	.status-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.35rem 0.7rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.status-queued {
		background: rgba(59, 130, 246, 0.18);
		color: #1d4ed8;
	}

	.status-dispatched,
	.status-processing,
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

	.empty {
		color: var(--text-muted);
		font-style: italic;
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

	@media (max-width: 880px) {
		.hero {
			grid-template-columns: 1fr;
		}

		.hero-stats {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 640px) {
		.layout {
			padding: 2.5rem 1.1rem 3.5rem;
			gap: 2rem;
		}

		.top-bar {
			flex-direction: column;
			align-items: flex-start;
			gap: 1rem;
		}

		.auth-actions {
			width: 100%;
			justify-content: flex-start;
		}

		.hero {
			padding: 2rem;
		}

		.hero-stats {
			grid-template-columns: 1fr;
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

		.panel {
			padding: 1.6rem;
		}
	}
</style>
