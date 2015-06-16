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
        categories: [],
        $posts: [],
        $ownPosts: []
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

    // Fill $posts for each category
    debug("** Fill $posts...");
    _.forEach(opts.collections, function(collectionData) {
      var collection = _.findWhere(collections, {id: collectionData.id});
      traverseCollectionCategoriesDeep(collection, fillPosts);
      fillPosts(collection);

      function fillPosts(collectionOrCategory) {
        debug("Filling $posts for %s", collectionOrCategory.id);
        var childPosts = _.reduce(collectionOrCategory.categories, function(total, curr) {
          total.push(curr.$posts);
          return total;
        }, []);
        childPosts.push(collectionOrCategory.$ownPosts);

        collectionOrCategory.$posts = _(childPosts).flatten().uniq().value();

        return collectionOrCategory;
      }
    });


    // order collection posts
    debug("** Order $ownPosts...");
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
        var sortedPosts = _.sortBy(category.$ownPosts, sortFn);

        if (reverse) {
          sortedPosts = _.reverse(sortedPosts);
        }

        category.$ownPosts = sortedPosts;

        return category;
      });
    });

    // fill stats
    debug("** Fill stats started!");
    _.forEach(opts.collections, function(collectionData) {
      var collection = _.findWhere(collections, {id: collectionData.id});
      traverseCollectionCategoriesDeep(collection, calculateStats);
      calculateStats(collection);

      function calculateStats(collectionOrCategory) {
        debug("Calculating stats for %s", collectionOrCategory.id);

        collectionOrCategory.stats.ownContentCount = collectionOrCategory.$ownPosts.length;
        collectionOrCategory.stats.ownLastPost = _.reduce(collectionOrCategory.$ownPosts, function(pre, curr) { return (pre === null || pre < curr.date) ? curr.date : pre; }, null);

        collectionOrCategory.stats.contentCount = collectionOrCategory.$posts.length;
        collectionOrCategory.stats.lastPost = _.reduce(collectionOrCategory.$posts, function(pre, curr) { return (pre === null || pre < curr.date) ? curr.date : pre; }, null);

        return collectionOrCategory;
      }
    });

    debug("** Pagination started!");
    _.forEach(opts.collections, function(collectionData) {
      var collection = _.findWhere(collections, {id: collectionData.id});
      traverseCollectionCategoriesDeep(collection, function(category) {
        debug("Setting next/prev for %s", category.id);

        category.$paginatedOwnPosts = _.chunk(category.$ownPosts, collectionData.backend.pagination);
        return category;
      });
    });

    // Expose generated collections
    var metadata = metalsmith.metadata();
    metadata.collections = collections;

    done();

    function registerPostOnCategory(collectionId, categoryName, postData) {
      // check if exists, if not append it to proper tree
      var categoryHierarchy = getCollectionContentHierarchy(categoryName);
      var collection = _.findWhere(collections, {id: collectionId});

      var currentCategory = collection.categories;
      var categoryUrl = "";
      while (categoryHierarchy.length > 0) {
        var aCategoryName = categoryHierarchy.shift();
        var aCategoryId = slug(aCategoryName, {lower: true});
        categoryUrl = categoryUrl + path.sep + aCategoryId;

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
            $categoryUrl: categoryUrl,
            $ownPosts: [],
            $posts: []
          };

          currentCategory.push(categoryObj);
        }
        currentCategory = categoryObj.categories;

        if (categoryHierarchy.length === 0) {
          categoryObj.$ownPosts.push(postData);
        }
      }

      function getCollectionContentHierarchy() {
        return categoryName.split(opts.backend.subCollectionSeperator);
      }
    }

    function traverseCollectionCategoriesDeep(categoryOrCollection, fn) {
      debug("Deep traversing %s", categoryOrCollection.id);
      // Plase note that this is a DFS traversal
      categoryOrCollection.categories = _.map(categoryOrCollection.categories, function(category) {
        traverseCollectionCategoriesDeep(category, fn);

        var updatedCategories = fn(category);
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
            $categoryUrl: "aa/bb",
            $ownPosts: [],
            $posts: []
          }],
          $ownPosts: [],
          $posts: []
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
