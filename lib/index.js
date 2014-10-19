"use strict";
var debug = require("debug")("metalsmith-multiple-collections");
var unique = require("uniq");
var _ = require("underscore");
var minimatch = require("minimatch");
var check = require("check-types");
var extendify = require("extendify");
var permalinks = require("permalinks");
var path = require("path");
_.extendDeep = extendify();

/**
 * Normalizes collection contents of a post to Array and
 * returns collection contents of a given collection name
 * and post.
 *
 * @param {Object} collectionName - The collection name we are interested in
 * @param {Object} data - Post data
 * @return {Array} Array of collection contents
 */
function match(collectionName, data) {
	var matches = [];

	if (data[collectionName]) {
		var collectionContents = data[collectionName];
		if (!Array.isArray(collectionContents)) {
			collectionContents = [collectionContents];
		}
		collectionContents.forEach(function(key){
			matches.push(key);
		});
	}

	data[collectionName] = unique(matches);
	return data[collectionName];
}

/**
 * Metalsmith multiple-collections plugin.
 *
 * Using this plugin, you can have more than one
 * taxonomies at the same time.
 *
 * @param opts
 * @returns {Function}
 */
function plugin(opts) {
	opts = normalize(opts);

	return function(files, metalsmith, done){
		var collections = {};

		// filter files which are not matching src
		var tbCategorizedFiles = _.filter(Object.keys(files), function(file) {
			return minimatch(file, opts.src);
		});

		// for each file
		_.forEach(tbCategorizedFiles, function(file) {
			var data = files[file];
			debug("checking file: %s", file);

			// determine witch categories this file belong to
			_.map(opts.collections, function(collectionData, collectionName) {
				collections[collectionName] = collections[collectionName] || {};

				if (check.fn(collectionData.filterFn)) {
					// if we have filternFn then don't check for collection contents, run this Fn.
					var key = collectionData.filterFn(data, file); // run filter fn against current file
					if (check.string(key)) {
						collections[collectionName][key] = collections[collectionName][key] || [];
						collections[collectionName][key].push(data);
					}
				} else {
					// check for collection contents
					match(collectionName, data).forEach(function (key) {
						collections[collectionName][key] = collections[collectionName][key] || [];
						collections[collectionName][key].push(data);
					});
				}
			});
		});

		// Sort the collections.
		_.forEach(opts.collections, function(collection, collectionName) {
			var sort = opts.collections[collectionName].sortBy || "date";
			var reverse = opts.collections[collectionName].reverse;
			_.forEach(collections[collectionName], function(col, key) {
				debug("sorting collection %s:%s", collectionName, key);

				if (check.fn(sort)) {
					col.sort(sort);
				} else {
					col.sort(function (a, b) {
						a = a[sort];
						b = b[sort];
						if (!a && !b) { return 0; }
						if (!a) { return -1; }
						if (!b) { return 1; }
						if (b > a) { return -1; }
						if (a > b) { return 1; }
						return 0;
					});
				}

				if (reverse) {
					col.reverse();
				}

			});
		});

		// Add `next` and `previous` references for each collection.
		_.forEach(opts.collections, function(collection, collectionName) {

			_.forEach(collections[collectionName], function(col, key) {
				debug("referencing collection: %s:%s", collectionName, key);

				var last = col.length - 1;
				col.forEach(function (file, i) {
					file.collectionNavigation = file.collectionNavigation || {};
					file.collectionNavigation[collectionName] = file.collectionNavigation[collectionName] || {};

					var links = {};
					if (i !== 0) {
						links.previous = col[i - 1];
					} else {
						links.previous = null;
					}
					if (last !== i) {
						links.next = col[i + 1];
					} else {
						links.next = null;
					}
					file.collectionNavigation[collectionName][key] = links;
				});

			});
		});

		// for each collection generate collection page structure using conf
		_.forEach(collections, function(collectionData, collectionName) {
			_.forEach(collectionData, function(data, key) {

				// normalize options using default templates conf
				if (!check.array(opts.collections[collectionName].templates)) {
					opts.collections[collectionName].templates = opts.templates; // TODO do we need deep copy?
				}

				// generate pages
				_.forEach(opts.collections[collectionName].templates, function(aTemplate) {

					var numPages = Math.ceil(data.length / aTemplate.paginateBy);
					if (check.intNumber(aTemplate.pageLimit)) {
						numPages = Math.min(numPages, aTemplate.pageLimit);
					}
					var previousFile = null;
					var currentFile = null;

					for (var i = 0; i < numPages; i++) {

						var urlVariables = {
							collection: collectionName,
							collectionItem: key,
							page: i.toString()
						};

						var url = null;
						if (i === 0 && check.string(aTemplate.fistPagePermalink)) {
							url = permalinks(aTemplate.fistPagePermalink, urlVariables);
						} else {
							url = permalinks(aTemplate.permalink, urlVariables);
						}

						var start = i * aTemplate.paginateBy;
						var end =  Math.min((i + 1) * aTemplate.paginateBy, data.length);

						currentFile = {
							template: path.join(opts.templateDir, aTemplate.file),
							type: "collection",
							prev: previousFile,
							next: null,
							contents: "__COLLECTION__",
							posts: data.slice(start, end),
							num: i + 1,
							total: numPages,
							start: start + 1,
							end: end + 1
						};

						if (check.object(previousFile)) {
							previousFile.next = currentFile;
						}

						files[url] = currentFile;
						previousFile = currentFile;
					}

				});

			});
		});

		// expose generated collections
		var metadata = metalsmith.metadata();
		metadata.collections = collections;

		done();
	};
}

/**
 * Normalize options using default data.
 *
 * @param {Object} options
 * @returns {Object} mergedOptions
 */
function normalize(options) {
  var defaults = {
    collections: {}
  };
  options = _.extendDeep(defaults, options);

  return options;
}

module.exports = plugin;
