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

	return function(files, metalsmith, done) {
		// initialize collections
    var collections = {
      page: null,
      contents: {}
    };
    _.forEach(opts.collections, function(data, name) {
      collections.contents[name] = {
        name: data.name,
        contents: {}
      };
    });

		// filter files which are not matching src
		var tbCategorizedFiles = _.filter(Object.keys(files), function(file) {
			return minimatch(file, opts.src);
		});

		// for each file
		_.forEach(tbCategorizedFiles, function(file) {
			var data = files[file];
			debug("checking file: %s", file);

			// determine which categories this file belong to
			_.forEach(opts.collections, function(collectionData, collectionName) {

				if (check.fn(collectionData.filterFn)) {
					// if we have filternFn then don't check for collection contents, run this Fn.
					var key = collectionData.filterFn(data, file); // run filter fn against current file
					if (check.string(key)) {
            registerCollectionContent(collectionName, key).posts.push(data);
					}
				} else {
					// check for collection contents
					match(collectionName, data).forEach(function (key) {
            registerCollectionContent(collectionName, key).posts.push(data);
					});
				}
			});
		});

		// Sort the collections.
		_.forEach(opts.collections, function(collection, collectionName) {
			var sortFn = opts.collections[collectionName].sortBy || "date";
			var reverse = opts.collections[collectionName].reverse;

      recursiveCollectionContentTraverse(collections.contents[collectionName].contents,
        function(collectionContents, collectionName) {
          debug("sorting collection %s", collectionName);
          sort(collectionContents.posts, sortFn, reverse);
      });
		});

		// Add `next` and `previous` references for each collection.
		_.forEach(opts.collections, function(collection, collectionName) {

      recursiveCollectionContentTraverse(collections.contents[collectionName].contents,
        function(collectionContents, collectionName) {
          debug("setting next/prev %s", collectionName);

          var last = collectionContents.posts.length - 1;
          collectionContents.posts.forEach(function (file, i) {
            file.collectionNavigation = file.collectionNavigation || {};
            file.collectionNavigation[collectionName] = file.collectionNavigation[collectionName] || {};

            var links = {};
            if (i !== 0) {
              links.previous = collectionContents.posts[i - 1];
            } else {
              links.previous = null;
            }
            if (last !== i) {
              links.next = collectionContents.posts[i + 1];
            } else {
              links.next = null;
            }
            file.collectionNavigation[collectionName][collectionName] = links;
          });
      });
		});


    // normalize options using default templates conf
    if (check.array(opts.collectionListTemplates)) {
      // generate collection pages
      _.forEach(opts.collectionListTemplates, function(aTemplate) {
        var url = aTemplate.permalink;
        var currentFile = {
          template: path.join(opts.templateDir, aTemplate.file),
          type: "collectionContents",
          contents: "__COLLECTION_LIST__",
          data: collections
        };

        files[url] = currentFile;
        if (collections.page === null) {
          collections.page = currentFile;
        }
      });
    }

		// for each collection generate collection page structure using conf
		_.forEach(collections.contents, function(collectionData, collectionName) {

      // normalize options using default templates conf
      if (!check.array(opts.collections[collectionName].collectionContentsTemplates)) {
        opts.collections[collectionName].collectionContentsTemplates = opts.collectionContentsTemplates;
      }

      // generate collection content pages
      _.forEach(opts.collections[collectionName].collectionContentsTemplates, function(aTemplate) {
        var urlVariables = {
          collection: collectionName
        };
        var url = permalinks(aTemplate.permalink, urlVariables);
        var currentFile = {
          template: path.join(opts.templateDir, aTemplate.file),
          type: "collectionContents",
          contents: "__COLLECTION_CONTENTS__",
          data: collectionData
        };

        files[url] = currentFile;
        if (!check.defined(collectionData.page)) {
          collectionData.page = currentFile;
        }
      });


      recursiveCollectionContentTraverse(collectionData.contents,
        function(data, key) {

				// normalize options using default templates conf
				if (!check.array(opts.collections[collectionName].templates)) {
					opts.collections[collectionName].templates = opts.templates;
				}


        var firstFile = null;

				// generate pages
				_.forEach(opts.collections[collectionName].templates, function(aTemplate) {

					var numPages = Math.ceil(data.posts.length / aTemplate.paginateBy);
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
						var end = Math.min((i + 1) * aTemplate.paginateBy, data.posts.length);

						currentFile = {
							template: path.join(opts.templateDir, aTemplate.file),
							type: "collection",
							prev: previousFile,
							next: null,
							contents: "__COLLECTION__",
							posts: data.posts.slice(start, end),
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
            if (firstFile === null) { firstFile = currentFile; }
					}

          data.page = firstFile;
				});

			});
		});

    // expose generated collections
    var metadata = metalsmith.metadata();
    metadata.collections = collections;

    done();

    function registerCollectionContent(collectionName, collectionContentName) {
      // check if exists, if not append it to proper tree

      var collectionContentHierarchy = getCollectionContentHierarchy(collectionContentName);
      var superCollectionContent = null;
      _.each(collectionContentHierarchy, function(h) {

        var collectionContentObj = collections.contents[collectionName].contents[h];
        if (!check.object(collectionContentObj)) {
          collectionContentObj = createEmptyCollectionContent();

          if (superCollectionContent === null) {
            collections.contents[collectionName].contents[h] = collectionContentObj;

          } else {
            superCollectionContent.subcontents[h] = collectionContentObj;
          }
        }

        superCollectionContent = collectionContentObj;
      });

      return superCollectionContent;

      function getCollectionContentHierarchy() {
        return collectionContentName.split(opts.subCollectionSeperator);
      }

      function createEmptyCollectionContent() {
        return {
          name: check.fn(opts.collections[collectionName].readableNameFn) ?
            opts.collections[collectionName].readableNameFn(collectionContentName) :
            _.last(collectionContentHierarchy),
          posts: [],
          subcontents: {}
        };
      }
    }

    function sort(what, fn, reverse) {
      if (check.fn(fn)) {
        what.sort(fn);
      } else {
        what.sort(function (a, b) {
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
        what.reverse();
      }
      return what;
    }

    function recursiveCollectionContentTraverse(collectionContents, fn) {
      _.forEach(collectionContents, function(contents, name) {
        fn(contents, name);

        recursiveCollectionContentTraverse(contents.subcontents, fn);
      });
    }

    /*
      collections {
        page: // PAGE //
        contents: {
          collectionName: {
            name: // READABLE NAME //
            page: // PAGE //
            contents: {
              aConnect: {
                name: // READABLE NAME //
                page: // PAGE //
                subcontents: {
                 // SAME AS contents: {..} but for subcontent of this content. This can go to infinite.
                }
                posts: [
                 // REFERENCE TO POSTS
                ]
              }
            }
          }
        }
      }
    */
	};
}

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
 * Normalize options using default data.
 *
 * @param {Object} options
 * @returns {Object} mergedOptions
 */
function normalize(options) {
  var defaults = {
    src: "**/*.md",
    subCollectionSeperator: "/",
    collections: {}
  };
  options = _.extendDeep({}, defaults, options);

  return options;
}

module.exports = plugin;
