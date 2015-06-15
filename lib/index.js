"use strict";
var debug = require("debug")("metalsmith-json-taxonomy");
var _ = require("lodash");
var minimatch = require("minimatch");
var slug = require("slug");
var path = require("path");

function plugin(opts) {
  opts = normalize(opts);

  return function(files, metalsmith, done) {
    // normalize each collections' backend options
    _.each(opts.collections, function(collectionData) {
      var collectionOpts = collectionData.backend;
      if (!_.isPlainObject(collectionOpts)) { collectionOpts = {}; }
      collectionData.backend = _.merge({}, opts.backend.defaultCollectionConfig, collectionOpts);
    });

    // initialize final collections array
    var collections = [];

    _.each(opts.collections, function(collectionData) {
      var aCollection = {
        id: collectionData.id,
        config: collectionData.frontend,
        stats: {
          contentCount: 0,
          ownContentCount: 0,
          lastPost: null
        },
        categories: []
      };
      collections.push(aCollection);
    });

    // filter out files that doesn't match filter
    var tbCategorizedFiles = _.filter(Object.keys(files), function(file) {
      return minimatch(file, opts.backend.src);
    });

    // for each file, get collection and sub collection data, add post into proper positions in tree
    _.each(tbCategorizedFiles, function(file) {
      var data = files[file];
      debug("Checking file: %s", file);

      // check each collection data, if any defined in that file
      _.each(opts.collections, function(collectionData) {
        var postCategories = data[collectionData.id];
        // if this collection defines a dynamic categorization function, call it
        if (_.isFunction(collectionData.backend.filterFn)) {
          // run filter fn against current file, expection array of strings in return
          postCategories = collectionData.backend.filterFn(data, file);
        }
        postCategories = normalizeCategoryNames(postCategories);

        _.each(postCategories, function(categoryName) {
          registerPostOnCategory(collectionData.id, categoryName, data);
        });
      });
    });

    // order collection posts
    _.forEach(opts.collections, function(collectionData) {
      var reverse = collectionData.backend.reverse;
      var sortFn = collectionData.backend.sortBy;
      if (_.isString(sortFn)) {
        sortFn = function(a, b) {
          a = a[collectionData.backend.sortBy];
          b = b[collectionData.backend.sortBy];
          if (b > a) { return -1; }
          if (a > b) { return 1; }
          return 0;
        };
      }

      var collection = _.findWhere(collections, {id: collectionData.id});

      traverseCollectionCategoriesDeep(collection, function(category) {
        debug("sorting collection %s", category.id);
        var sortedPosts = _.sortBy(category.$posts, sortFn);

        if (reverse) {
          sortedPosts = _.reverse(sortedPosts);
        }

        category.$posts = sortedPosts;

        return category;
      });
    });

    // fill stats

    // Add `next` and `previous` references for each collection.



    //_.forEach(opts.collections, function(collection, collectionName) {
    //
    //  recursiveCollectionContentTraverse(collections.contents[collectionName].contents,
    //    function(collectionContents, collectionName) {
    //      debug("setting next/prev %s", collectionName);
    //
    //      var last = collectionContents.posts.length - 1;
    //      collectionContents.posts.forEach(function (file, i) {
    //        file.collectionNavigation = file.collectionNavigation || {};
    //        file.collectionNavigation[collectionName] = file.collectionNavigation[collectionName] || {};
    //
    //        var links = {};
    //        if (i !== 0) {
    //          links.previous = collectionContents.posts[i - 1];
    //        } else {
    //          links.previous = null;
    //        }
    //        if (last !== i) {
    //          links.next = collectionContents.posts[i + 1];
    //        } else {
    //          links.next = null;
    //        }
    //        file.collectionNavigation[collectionName][collectionName] = links;
    //      });
    //  });
    //});


    //// normalize options using default templates conf
    //if (check.array(opts.collectionListTemplates)) {
    //  // generate collection pages
    //  _.forEach(opts.collectionListTemplates, function(aTemplate) {
    //    var url = aTemplate.permalink;
    //    var currentFile = {
    //      template: path.join(opts.templateDir, aTemplate.file),
    //      type: "collectionContents",
    //      contents: "__COLLECTION_LIST__",
    //      data: collections
    //    };
    //
    //    files[url] = currentFile;
    //    if (collections.page === null) {
    //      collections.page = currentFile;
    //    }
    //  });
    //}
    //
    //// for each collection generate collection page structure using conf
    //_.forEach(collections.contents, function(collectionData, collectionName) {
    //
    //  // normalize options using default templates conf
    //  if (!check.array(opts.collections[collectionName].collectionContentsTemplates)) {
    //    opts.collections[collectionName].collectionContentsTemplates = opts.collectionContentsTemplates;
    //  }
    //
    //  // generate collection content pages
    //  _.forEach(opts.collections[collectionName].collectionContentsTemplates, function(aTemplate) {
    //    var urlVariables = {
    //      collection: collectionName
    //    };
    //    var url = permalinks(aTemplate.permalink, urlVariables);
    //    var currentFile = {
    //      template: path.join(opts.templateDir, aTemplate.file),
    //      type: "collectionContents",
    //      contents: "__COLLECTION_CONTENTS__",
    //      data: collectionData
    //    };
    //
    //    files[url] = currentFile;
    //    if (!check.defined(collectionData.page)) {
    //      collectionData.page = currentFile;
    //    }
    //  });
    //
    //
    //  recursiveCollectionContentTraverse(collectionData.contents,
    //    function(data, key) {
    //
    //    // normalize options using default templates conf
    //    if (!check.array(opts.collections[collectionName].templates)) {
    //      opts.collections[collectionName].templates = opts.templates;
    //    }
    //
    //
    //    var firstFile = null;
    //
    //    // generate pages
    //    _.forEach(opts.collections[collectionName].templates, function(aTemplate) {
    //
    //      var numPages = Math.ceil(data.posts.length / aTemplate.paginateBy);
    //      if (check.intNumber(aTemplate.pageLimit)) {
    //        numPages = Math.min(numPages, aTemplate.pageLimit);
    //      }
    //      var previousFile = null;
    //      var currentFile = null;
    //
    //      for (var i = 0; i < numPages; i++) {
    //
    //        var urlVariables = {
    //          collection: collectionName,
    //          collectionItem: key,
    //          page: i.toString()
    //        };
    //
    //        var url = null;
    //        if (i === 0 && check.string(aTemplate.fistPagePermalink)) {
    //          url = permalinks(aTemplate.fistPagePermalink, urlVariables);
    //        } else {
    //          url = permalinks(aTemplate.permalink, urlVariables);
    //        }
    //
    //        var start = i * aTemplate.paginateBy;
    //        var end = Math.min((i + 1) * aTemplate.paginateBy, data.posts.length);
    //
    //        currentFile = {
    //          template: path.join(opts.templateDir, aTemplate.file),
    //          type: "collection",
    //          prev: previousFile,
    //          next: null,
    //          contents: "__COLLECTION__",
    //          posts: data.posts.slice(start, end),
    //          num: i + 1,
    //          total: numPages,
    //          start: start + 1,
    //          end: end + 1
    //        };
    //
    //        if (check.object(previousFile)) {
    //          previousFile.next = currentFile;
    //        }
    //
    //        files[url] = currentFile;
    //        previousFile = currentFile;
    //        if (firstFile === null) { firstFile = currentFile; }
    //      }
    //
    //      data.page = firstFile;
    //    });
    //
    //  });
    //});

    // Expose generated collections
    var metadata = metalsmith.metadata();
    metadata.collections = collections;

    done();

    function registerPostOnCategory(collectionId, categoryName, postData) {
      // check if exists, if not append it to proper tree
      var categoryHierarchy = getCollectionContentHierarchy(categoryName);
      var collection = _.findWhere(collections, {id: collectionId});

      var currentCategory = collection.categories;
      while (categoryHierarchy.length > 0) {
        var aCategoryName = categoryHierarchy.shift();
        var aCategoryId = slug(aCategoryName, {lower: true});

        var categoryObj = _.findWhere(currentCategory, {id: aCategoryId}); // id vs name on subcategories + their normalization
        if (!_.isPlainObject(categoryObj)) {
          categoryObj = {
            id: aCategoryId,
            config: {
              name: aCategoryName
            },
            stats: {
              contentCount: 0,
              ownContentCount: 0,
              lastPost: null
            },
            categories: [],
            $posts: []
          };

          currentCategory.push(categoryObj);
        }
        currentCategory = categoryObj.categories;

        if (categoryHierarchy.length === 0) {
          categoryObj.$posts.push(postData);
        }
      }

      function getCollectionContentHierarchy() {
        return categoryName.split(opts.backend.subCollectionSeperator);
      }
    }

    function traverseCollectionCategoriesDeep(categoryOrCollection, fn) {
      categoryOrCollection.categories = _.map(categoryOrCollection.categories, function(category) {
        var updatedCategories = fn(category);

        traverseCollectionCategoriesDeep(category.categories, fn);

        return updatedCategories;
      });
    }


    /*
      collections: [
        {
         id: "bla",
         config: FECONFIG,
         stats: {
           contentCount: 0,
           ownContentCount: 0,
           lastPost: null
         },
         categories: [{
           id: "aha",
           config: FECONFIG,
           stats: {
             contentCount: 0,
             ownContentCount: 0,
             lastPost: null
           },
           categories: [],
           $posts: []
         }]
        }
      ]
     */
  };
}

function normalizeCategoryNames(randomInput) {
  if (_.isString(randomInput)) {
    return [randomInput];
  }

  if (_.isArray(randomInput)) {
    var tbReturned = [];
    _.each(randomInput, function(v) {
      if (_.isString(v)) {
        tbReturned.push(v);
      }
    });
    return _.uniq(tbReturned);
  }

  return [];
}

function normalize(options) {
  var defaults = {
    backend: {
      src: "**/*.md",
      subCollectionSeperator: "/",
      pagination: 10,
      postSorting: {
        sortBy: "date",
        reverse: true
      }
    },
    frontend: {},
    collections: []
  };
  options = _.merge({}, defaults, options);

  return options;
}

module.exports = plugin;
