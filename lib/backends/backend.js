var _ = require('lodash');
var Q = require('q');
var path = require('path');
var os = require('os');
var destroy = require('destroy');
var LRU = require('lru-diskcache');
var streamRes = require('stream-res');
var Buffer = require('buffer').Buffer;

function Backend(nuts, opts) {
    this.cacheId = 0;
    this.nuts = nuts;
    this.opts = _.defaults(opts || {}, {
        // Folder to cache assets
        cache: path.resolve(os.tmpdir(), 'nuts'),

        // Cache configuration
        cacheMax: 500 * 1024 * 1024,
        cacheMaxAge: 60 * 60 * 1000,
    });

    // Create cache
    this.cache = LRU(opts.cache, {
        max: opts.cacheMax,
        maxAge: opts.cacheMaxAge
    });

    _.bindAll(this);
}

// Memoize a function
Backend.prototype.memoize = function(fn) {
    var that = this;

    return _.memoize(fn, function() {
        return that.cacheId+Math.ceil(Date.now()/that.opts.cacheMaxAge)
    });
};

// New release? clear cache
Backend.prototype.onRelease = function() {
    this.cacheId++;
};

// Initialize the backend
Backend.prototype.init = function() {
    this.cache.init();
    return Q();
};

// List all releases for this repository
Backend.prototype.releases = function() {

};

// Return stream for an asset
Backend.prototype.serveAsset = function(asset, req, res) {
    var that = this;
    var cacheKey = asset.id;

    function outputStream(stream) {
        var d = Q.defer();
        streamRes(res, stream, d.makeNodeResolver());
        return d.promise;
    }

    res.attachment(asset.filename);

    return that.getAssetStream(asset)
    .then(function(stream) {
        if (that.opts.behindReverseProxy) {
            return Q(stream
                .on('response', function(res) {
                    delete res.headers['etag'];
                    res.headers['cache-control'] = 'max-age=7200';
                })
                .pipe(res));
        }
        return Q.all([
            // Send the stream to the user
            outputStream(stream)
        ]);
    });
};

// Return stream for an asset
Backend.prototype.getAssetStream = function(asset) {

};

// Return stream for an asset
Backend.prototype.readAsset = function(asset) {
    return this.getAssetStream(asset)
    .then(function(res) {
        var d = Q.defer();
        var output = Buffer([]);

        function cleanup() {
            destroy(res);
            res.removeAllListeners();
        }

        res.on('data', function(buf) {
                output = Buffer.concat([output, buf]);
            })
            .on('error', function(err) {
                cleanup();
                d.reject(err);
            })
            .on('end', function() {
                cleanup();
                d.resolve(output);
            });

        return d.promise

    })
};

module.exports = Backend;
