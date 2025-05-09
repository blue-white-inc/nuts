const _ = require('lodash');
const util = require('util');
const { Octokit } = require('@octokit/rest');
const axios = require('axios');
const createWebhookHandler = require('github-webhook-handler');

const Backend = require('./backend');

function GitHubBackend() {
	const that = this;
	Backend.apply(this, arguments);

	this.opts = _.defaults(this.opts || {}, {
		proxyAssets: true
	});

	if ((!this.opts.username || !this.opts.password) && (!this.opts.token)) {
		throw new Error('GitHub backend require "token" or "username" and "password" options');
	}

	// Configure Octokit client
	const octokitOptions = {
		auth: this.opts.token,
	};

	// Add endpoint if specified
	if (this.opts.endpoint) {
		octokitOptions.baseUrl = this.opts.endpoint;
	}

	// Add basic auth if using username/password
	if (!this.opts.token && this.opts.username && this.opts.password) {
		octokitOptions.auth = {
			username: this.opts.username,
			password: this.opts.password,
			async on2fa() {
				throw new Error('Two-factor authentication is not supported');
			}
		};
	}

	this.client = new Octokit(octokitOptions);
	
	// Parse owner and repo from repository string (format: owner/repo)
	const [owner, repo] = this.opts.repository.split('/');
	this.owner = owner;
	this.repo = repo;
	
	this.releases = this.memoize(this._releases);

	// GitHub webhook to refresh list of versions
	this.webhookHandler = createWebhookHandler({
		path: '/refresh',
		secret: this.opts.refreshSecret
	});

	// Webhook from GitHub
	this.webhookHandler.on('release', function(event) {
		that.onRelease();
	});
	this.nuts.router.use(this.webhookHandler);
}
util.inherits(GitHubBackend, Backend);

// List all releases for this repository
GitHubBackend.prototype._releases = function() {
	return this.client.repos.listReleases({
		owner: this.owner,
		repo: this.repo,
		per_page: 100
	})
	.then(response => {
		return response.data;
	});
};

// Return stream for an asset
GitHubBackend.prototype.serveAsset = function(asset, req, res) {
	if (!this.opts.proxyAssets) {
		res.redirect(asset.raw.browser_download_url);
	} else {
		return Backend.prototype.serveAsset.apply(this, arguments);
	}
};

// Return stream for an asset
GitHubBackend.prototype.getAssetStream = function(asset) {
	const headers = {
		'User-Agent': 'nuts',
		'Accept': 'application/octet-stream'
	};
	let auth = {};

	if (this.opts.token) {
		headers['Authorization'] = `token ${this.opts.token}`;
	} else if (this.opts.username) {
		auth = {
			username: this.opts.username,
			password: this.opts.password
		};
	}

	return axios({
		url: asset.raw.url,
		method: 'get',
		headers: headers,
		auth: auth,
		responseType: 'arraybuffer'
	}).then(response => {
		return response.data;
	});
};

module.exports = GitHubBackend;