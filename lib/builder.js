/**
 * Copyright (c) 2011, Yahoo! Inc. All rights reserved.
 * Code licensed under the BSD License:
 * https://github.com/yui/yuidoc/blob/master/LICENSE
 */
'use strict';

var MarkdownIt = require('markdown-it');
var fs = require('graceful-fs');
var mdn = require('mdn-links');
var noop = function() {};
var path = require('path');
var TEMPLATE;

/**
* Takes the `JSON` data from the `DocParser` class, creates and parses markdown and handlebars
based templates to generate static HTML content
* @class DocBuilder
* @module yuidoc
*/

YUI.add('doc-builder', function(Y) {
    var defaultMarkdownOption = {
        html: true,
        linkify: true
    };

    var fixType = Y.Lang.fixType,
        print = function(items) {
            var out = '<ul>';

            Y.each(items, function(i, k) {
                out += '<li>';
                if (Y.Lang.isObject(i)) {
                    if (!i.path) {
                        out += k + '/' + print(i);
                    } else {
                        out += '<a href="../files/' + i.name + '.html">' + k + '</a>';
                    }
                }
                out += '</li>';
            });

            out += '</ul>';
            return out;
        };

    Y.Handlebars.registerHelper('buildFileTree', function(items) {
        return print(items);
    });

    var DEFAULT_THEME = path.join(__dirname, '../', 'themes', 'default'),
        themeDir = DEFAULT_THEME;

    Y.DocBuilder = function(options, data) {
        this.directories = ['files', 'elements', 'classes', 'modules', 'interfaces', 'namespaces'];
        this.typeToRenderFunction = {
            classes: 'renderClass',
            interfaces: 'renderInterface',
            modules: 'renderModule',
            namespaces: 'renderNamespaces',
            elements: 'renderElement',
            files: 'renderFile'
        }

        this.options = options;
        if (options.helpers) {
            this._addHelpers(options.helpers);
        }
        if (options.themedir) {
            themeDir = options.themedir;
        }
        this.md = new MarkdownIt(Y.merge(defaultMarkdownOption, options.markdown));
        this.data = data;
        Y.log('Building..', 'info', 'builder');
        this.files = 0;
        var self = this;

        Y.Handlebars.registerHelper('crossLink', function(item, helperOptions) {
            var str = '';
            if (!item) {
                item = '';
            }
            //console.log('CrossLink:', item);
            if (item.indexOf('|') > 0) {
                var parts = item.split('|'),
                    p = [];
                Y.each(parts, function(i) {
                    p.push(self._parseCrossLink.call(self, i));
                });
                str = p.join(' | ');
            } else {
                str = self._parseCrossLink.call(self, item, false, helperOptions.fn(this));
            }
            return str;
        });

        Y.Handlebars.registerHelper('crossLinkModule', function(item, helperOptions) {
            var str = item;
            if (self.data.modules[item]) {
                var content = helperOptions.fn(this);
                if (content === '') {
                    content = item;
                }
                str = '<a href="../modules/' + item.replace(/\//g, '_') +
                    '.html">' + content + '</a>';
            }
            return str;
        });

        Y.Handlebars.registerHelper('crossLinkRaw', function(item) {
            var str = '';
            if (!item) {
                item = '';
            }
            if (item.indexOf('|') > 0) {
                var parts = item.split('|'),
                    p = [];
                Y.each(parts, function(i) {
                    p.push(self._parseCrossLink.call(self, i, true));
                });
                str = p.join(' | ');
            } else {
                str = self._parseCrossLink.call(self, item, true);
            }
            return str;
        });

        this.cacheTemplates = true;
        if (options.cacheTemplates === false) {
            this.cacheTemplates = false;
        }
    };

    Y.DocBuilder.prototype = {
        /**
         * Register a `Y.Handlebars` helper method
         * @method _addHelpers
         * @param {Object} helpers Object containing a hash of names and functions
         */
        _addHelpers: function(helpers) {
            Y.log('Importing helpers: ' + helpers, 'info', 'builder');
            helpers.forEach(function(imp) {
                if (!Y.Files.exists(imp) || Y.Files.exists(path.join(process.cwd(), imp))) {
                    imp = path.join(process.cwd(), imp);
                }
                var h = require(imp);
                Object.keys(h).forEach(function(name) {
                    Y.Handlebars.registerHelper(name, h[name]);
                });
            });
        },

        /**
         * Wrapper around the Markdown parser so it can be normalized or even side stepped
         * @method markdown
         * @private
         * @param {String} data The Markdown string to parse
         * @return {HTML} The rendered HTML
         */
        markdown: function(data) {
            var html = this.md.render(data);
            //Only reprocess if helpers were asked for
            if (this.options.helpers || (html.indexOf('{{#crossLink') > -1)) {
                try {
                    // markdown-it auto-escapes quotation marks (and unfortunately
                    // does not expose the escaping function)
                    html = html.replace(/&quot;/g, '"');
                    html = (Y.Handlebars.compile(html))({});
                } catch (hError) {
                    //Remove all the extra escapes
                    html = html.replace(/\\{/g, '{').replace(/\\}/g, '}');
                    Y.log('Failed to parse Handlebars, probably an unknown helper, skipping..', 'warn', 'builder');
                }
            }
            return html;
        },

        /**
         * Parse the item to be cross linked and return an HREF linked to the item
         * @method _parseCrossLink
         * @private
         * @param {String} item The item to crossLink
         * @param {Boolean} [raw=false] Do not wrap it in HTML
         * @param {String} [content] crossLink helper content
         */
        _parseCrossLink: function(item, raw, content) {
            var self = this;
            var parts,
                base = '../',
                baseItem,
                newWin = false,
                group = /&lt;.*(?=&gt;$)/.test(item) ? 'elements' : 'classes',
                className = 'crosslink';

            if (group === 'classes') {
                item = fixType(item);
            }

            item = baseItem = Y.Lang.trim(item.replace('{', '').replace('}', ''));
            //Remove Cruft
            item = item.replace('*', '').replace('[', '').replace(']', '').replace('&lt;', '').replace('&gt;', '');

            var link = false,
                href;

            if (group === 'classes' && !self.data[group][item]) {
                group = 'interfaces';
            }

            if (self.data[group][item]) {
                link = true;
            } else {
                if (self.data[group][item.replace('.', '')]) {
                    link = true;
                    item = item.replace('.', '');
                }
            }
            if (self.options.externalData) {
                if (self.data[group][item]) {
                    if (self.data[group][item].external) {
                        href = self.data[group][item].path;
                        base = self.options.externalData.base;
                        className += ' external';
                        newWin = true;
                        link = true;
                    }
                }
            }

            if (group === 'elements' && item.indexOf(' ') > -1) {
                // Fragment link for an attribute is required
                parts = item.split(' ');
                var el = parts[0],
                    attr = parts[1];

                if (el && attr) {
                    if (self.data.elements[el]) {
                        self.data.elements[el].attributes.some(function(i) {
                            if (i.name === attr) {
                                link = true;
                                baseItem = attr;
                                href = Y.webpath(base, 'elements', el + '.html#' + attr);
                            }
                        });
                    }
                }
            } else if (item.indexOf('/') > -1) {
                //We have a class + method to parse
                parts = item.split('/');
                var cls = parts[0],
                    method = parts[1],
                    type = 'method';

                if (method.indexOf(':') > -1) {
                    parts = method.split(':');
                    method = parts[0];
                    type = parts[1];
                    if (type.indexOf('attr') === 0) {
                        type = 'attribute';
                    }
                }

                if (cls && method) {
                    if (self.data.classes[cls]) {
                        self.data.classes[cls].items.forEach(function(i) {
                            if (i.itemtype === type && i.name === method) {
                                link = true;
                                baseItem = method;
                                var t = type;
                                if (t === 'attribute') {
                                    t = 'attr';
                                }
                                href = Y.webpath(base, 'classes', cls + '.html#' + t + '_' + method);
                            }
                        });
                    }
                }

            }

            if (!href && !link) {
                  href = self._parseCrossLinkToProperty(item, base);
                  if (href) {
                    link = true;
                  }
            }

            if (item === 'Object' || item === 'Array') {
                link = false;
            }
            if (!href) {
                href = Y.webpath(base, group, item + '.html');
                if (base.match(/^https?:\/\//)) {
                    href = base + Y.webpath(group, item + '.html');
                }
            }
            if (!link && self.options.linkNatives) {
                href = mdn.getLink.apply(mdn, item.split('/'));
                if (href) {
                    className += ' external';
                    newWin = true;
                    link = true;
                }
            }
            if (link) {
                if (content !== undefined) {
                    content = content.trim();
                }
                if (!content) {
                    content = baseItem;
                }
                item = '<a href="' + href + '" class="' + className + '"' + ((newWin) ? ' target="_blank"' : '') + '>' + content + '</a>';
            }
            return (raw) ? href : item;
        },
        _containers: [
            'classes',
            'interfaces',
            'namespaces'
        ],
        _parseCrossLinkToProperty: function(item, base) {
            var href;
            var objectName = item;
            var index;
            var container;
            var i;

            if (item && item.indexOf('.') != -1) {
                while ((index = objectName.lastIndexOf('.')) != -1 && !container) {
                    objectName = objectName.slice(0, index);
                    for (i = 0; i < this._containers.length && !container; i++) {
                        if (this.data[this._containers[i]][objectName]) {
                            container = this._containers[i];
                        }
                    }
                }
                if (container) {
                    var propertyName = item.slice(objectName.length + 1, item.length);
                    var items = this.data[container][objectName].items;

                    while (propertyName && !href) {
                        for (i = 0; i < items.length && !href; i++) {
                            if (items[i].itemtype && items[i].name === propertyName) {
                                href = Y.webpath(base, container, objectName + '.html#property_' + propertyName);
                            }
                        }
                        index = propertyName.lastIndexOf('.');
                        if (index != -1) {
                            propertyName = propertyName.slice(0, index);
                        } else {
                            propertyName = undefined;
                        }
                    }
                }
            }
            return href;
        },

        /**
         * Mixes the various external data soures together into the local data, augmenting
         * it with flags.
         * @method _mixExternal
         * @private
         */
        _mixExternal: function() {
            var self = this;

            Y.log('External data received, mixing', 'info', 'builder');
            self.options.externalData.forEach(function(exData) {
                self.directories.forEach(function(k) {
                    Y.each(exData[k], function(item, key) {
                        item.external = true;
                        var file = item.name;
                        if (!item.file) {
                            file = self.filterFileName(item.name);
                        }

                        if (item.type) {
                            item.type = fixType(item.type);
                        }

                        item.path = exData.base + path.join(k, file + '.html');

                        self.data[k][key] = item;
                    });
                });
                Y.each(exData.classitems, function(item) {
                    var container, object;
                    item.external = true;
                    item.path = exData.base + path.join('files', self.filterFileName(item.file) + '.html');
                    if (item.type) {
                        item.type = fixType(item.type);
                    }
                    if (item.params) {
                        item.params.forEach(function(p) {
                            if (p.type) {
                                p.type = fixType(p.type);
                            }
                        });
                    }
                    if (item.return) {
                        item.return.type = fixType(item.return.type);
                    }
                    if (item.class) {
                      container = 'classes';
                      object = item.class;
                    } else {
                      container = 'interfaces';
                      object = item.interface;
                    }

                    if (self.data[container][object]) {
                      if (!self.data[container][object].items) {
                        self.data[container][object].items = [];
                      }
                      self.data[container][object].items.push(item);
                    }
                });
            });
        },
        /**
         * Fetches the remote data and fires the callback when it's all complete
         * @method mixExternal
         * @param {Callback} cb The callback to execute when complete
         * @async
         */
        mixExternal: function(cb) {
            var self = this,
                info = self.options.external;

            if (!info) {
                cb();
                return;
            }
            if (!info.merge) {
                info.merge = 'mix';
            }
            if (!info.data) {
                Y.log('External config found but no data path defined, skipping import.', 'warn', 'builder');
                cb();
                return;
            }
            if (!Y.Lang.isArray(info.data)) {
                info.data = [info.data];
            }
            Y.log('Importing external documentation data.', 'info', 'builder');

            var stack = new Y.Parallel();
            info.data.forEach(function(i) {
                var base;
                if (typeof i === 'object') {
                    base = i.base;
                    i = i.json;
                }
                if (i.match(/^https?:\/\//)) {
                    if (!base) {
                        base = i.replace('data.json', '');
                    }
                    Y.use('io-base', stack.add(function() {
                        Y.log('Fetching: ' + i, 'info', 'builder');
                        Y.io(i, {
                            on: {
                                complete: stack.add(function(id, e) {
                                    Y.log('Received: ' + i, 'info', 'builder');
                                    var parsedData = JSON.parse(e.responseText);
                                    parsedData.base = base;
                                    if (!self.options.externalData) {
                                        self.options.externalData = [];
                                    }
                                    self.options.externalData.push(parsedData);
                                })
                            }
                        });
                    }));
                } else {
                    if (!base) {
                        base = path.dirname(path.resolve(i));
                    }
                    var data = Y.Files.getJSON(i);
                    data.base = base;
                    if (!self.options.externalData) {
                        self.options.externalData = [];
                    }
                    self.options.externalData.push(data);
                }
            });

            stack.done(function() {
                Y.log('Finished fetching remote data', 'info', 'builder');
                self._mixExternal();
                cb();
            });
        },
        /**
         * File counter
         * @property files
         * @type Number
         */
        files: null,
        /**
         * Holder for project meta data
         * @property _meta
         * @type Object
         * @private
         */
        _meta: null,
        /**
         * Prep the meta data to be fed to Selleck
         * @method getProjectMeta
         * @return {Object} The project metadata
         */
        getProjectMeta: function() {
            var obj = {
                meta: {
                    yuiSeedUrl: 'http://yui.yahooapis.com/3.5.0/build/yui/yui-min.js',
                    yuiGridsUrl: 'http://yui.yahooapis.com/3.5.0/build/cssgrids/cssgrids-min.css'
                }
            };
            if (!this._meta) {
                try {
                    var meta,
                        theme = path.join(themeDir, 'theme.json');
                    if (Y.Files.exists(theme)) {
                        Y.log('Loading theme from ' + theme, 'info', 'builder');
                        meta = Y.Files.getJSON(theme);
                    } else if (DEFAULT_THEME !== themeDir) {
                        theme = path.join(DEFAULT_THEME, 'theme.json');
                        if (Y.Files.exists(theme)) {
                            Y.log('Loading theme from ' + theme, 'info', 'builder');
                            meta = Y.Files.getJSON(theme);
                        }
                    }

                    if (meta) {
                        obj.meta = meta;
                        this._meta = meta;
                    }
                } catch (e) {
                    console.error('Error', e);
                }
            } else {
                obj.meta = this._meta;
            }
            Y.each(this.data.project, function(v, k) {
                var key = k.substring(0, 1).toUpperCase() + k.substring(1, k.length);
                obj.meta['project' + key] = v;
            });
            return obj;
        },
        /**
         * Populate the meta data for classes
         * @method populateClasses
         * @param {Object} opts The original options
         * @return {Object} The modified options
         */
        populateClasses: function(opts) {
            opts.meta.classes = [];
            Y.each(this.data.classes, function(v) {
                if (v.external) {
                    return;
                }
                opts.meta.classes.push({
                    displayName: v.name,
                    name: v.name,
                    namespace: v.namespace,
                    module: v.module,
                    description: v.description,
                    access: v.access || 'public'
                });
            });
            opts.meta.classes.sort(this.nameSort);
            return opts;
        },
        /**
         * Populate the meta data for elements
         * @method populateInterfaces
         * @param {Object} opts The original options
         * @return {Object} The modified options
         */
        populateInterfaces: function(opts) {
            opts.meta.interfaces = [];
            Y.each(this.data.interfaces, function(minterface) {
                if (minterface.external) {
                    return opts;
                }
                opts.meta.interfaces.push({
                    displayName: minterface.name,
                    name: minterface.name,
                    namespace: minterface.namespace,
                    module: minterface.module,
                    description: minterface.description,
                    access: minterface.access || 'public'
                })
            });
            return opts;
        },
        /**
         * Populate the meta data for elements
         * @method populateElements
         * @param {Object} opts The original options
         * @return {Object} The modified options
         */
        populateElements: function(opts) {
            opts.meta.elements = [];
            Y.each(this.data.elements, function(v) {
                if (v.external) {
                    return;
                }
                opts.meta.elements.push({
                    displayName: '<' + v.name + '>',
                    name: v.name,
                    module: v.module,
                    description: v.description
                });
            });
            opts.meta.elements.sort(this.nameSort);
            return opts;
        },
        /**
         * Populate the meta data for modules
         * @method populateModules
         * @param {Object} opts The original options
         * @return {Object} The modified options
         */
        populateModules: function(opts) {
            var self = this;
            opts.meta.modules = [];
            opts.meta.allModules = [];
            Y.each(this.data.modules, function(v) {
                if (v.external) {
                    return;
                }
                opts.meta.allModules.push({
                    displayName: v.displayName || v.name,
                    name: self.filterFileName(v.name),
                    description: v.description
                });
                if (!v.is_submodule) {
                    var o = {
                        displayName: v.displayName || v.name,
                        name: self.filterFileName(v.name)
                    };
                    if (v.submodules) {
                        o.submodules = [];
                        Y.each(v.submodules, function(i, k) {
                            var moddef = self.data.modules[k];
                            if (moddef) {
                                o.submodules.push({
                                    displayName: k,
                                    description: moddef.description
                                });
                            }
                        });
                        o.submodules.sort(self.nameSort);
                    }
                    opts.meta.modules.push(o);
                }
            });
            opts.meta.modules.sort(this.nameSort);
            opts.meta.allModules.sort(this.nameSort);
            return opts;
        },
        populateNamespaces: function(opts) {
            opts.meta.namespaces = [];
            Y.each(this.data.namespaces, function(namespace) {
                opts.meta.namespaces.push({
                    name: namespace.name,
                    namespaceClasses: namespace.classes,
                    namespaceInterfaces: namespace.interfaces,
                    namespaceSubNamespaces: namespace.namespaces
                });
            })
            return opts;
        },
        /**
         * Populate the meta data for files
         * @method populateFiles
         * @param {Object} opts The original options
         * @return {Object} The modified options
         */
        populateFiles: function(opts) {
            var self = this;
            opts.meta.files = [];
            Y.each(this.data.files, function(v) {
                if (v.external) {
                    return;
                }
                opts.meta.files.push({
                    displayName: v.name,
                    name: self.filterFileName(v.name),
                    path: v.path || v.name
                });
            });

            var tree = {};
            var files = [];
            Y.each(this.data.files, function(v) {
                if (v.external) {
                    return;
                }
                files.push(v.name);
            });
            files.sort();
            Y.each(files, function(v) {
                var p = v.split('/'),
                    par;
                p.forEach(function(i, k) {
                    if (!par) {
                        if (!tree[i]) {
                            tree[i] = {};
                        }
                        par = tree[i];
                    } else {
                        if (!par[i]) {
                            par[i] = {};
                        }
                        if (k + 1 === p.length) {
                            par[i] = {
                                path: v,
                                name: self.filterFileName(v)
                            };
                        }
                        par = par[i];
                    }
                });
            });

            opts.meta.fileTree = tree;

            return opts;
        },
        /**
         * Parses file and line number from an item object and build's an HREF
         * @method addFoundAt
         * @param {Object} a The item to parse
         * @return {String} The parsed HREF
         */
        addFoundAt: function(a) {
            var self = this;
            if (a.file && a.line && !self.options.nocode) {
                a.foundAt = '../files/' + self.filterFileName(a.file) + '.html#l' + a.line;
                if (a.path) {
                    a.foundAt = a.path + '#l' + a.line;
                }
            }
            return a;
        },
        /**
         * Augments the **DocParser** meta data to provide default values for certain keys as well as parses all descriptions
         * with the `Markdown Parser`
         * @method augmentData
         * @param {Object} o The object to recurse and augment
         * @return {Object} The augmented object
         */
        augmentData: function(o) {
            var self = this;
            o = self.addFoundAt(o);
            Y.each(o, function(i, k1) {
                if (i && k1 !== 'items' && i.forEach) {
                    Y.each(i, function(a, k) {
                        if (!(a instanceof Object)) {
                            return;
                        }
                        if (!a.type) {
                            a.type = 'Object'; //Default type is Object
                        }
                        if (a.final === '') {
                            a.final = true;
                        }
                        if (!a.description) {
                            a.description = ' ';
                        } else if (!o.extended_from) {
                            a.description = self.markdown(a.description);
                        }
                        if (a.example && !o.extended_from) {
                            a.example = self.markdown(a.example);
                        }
                        a = self.addFoundAt(a);

                        Y.each(a, function(c, d) {
                            if (c.forEach || (c instanceof Object)) {
                                c = self.augmentData(c);
                                a[d] = c;
                            }
                        });

                        o[k1][k] = a;
                    });
                } else if (i instanceof Object) {
                    i = self.addFoundAt(i);
                    Y.each(i, function(v, k) {
                        if (k === 'final') {
                            o[k1][k] = true;
                        } else if (k === 'description' || k === 'example') {
                            if (v.forEach || (v instanceof Object)) {
                                o[k1][k] = self.augmentData(v);
                            } else {
                                o[k1][k] = o.extended_from ? v : self.markdown(v);
                            }
                        }
                    });
                } else if (k1 === 'description' || k1 === 'example') {
                    o[k1] = o.extended_from ? i : self.markdown(i);
                }
            });
            return o;
        },
        /**
         * Makes the default directories needed
         * @method makeDirs
         * @param {Callback} cb The callback to execute after it's completed
         */
        makeDirs: function(cb) {
            var self = this;
            var dirs = self.directories;
            if (self.options.dumpview) {
                dirs.push('json');
            }
            var writeRedirect = function(dir, file, cbWriteRedirect) {
                Y.Files.exists(file, function(x) {
                    if (x) {
                        var out = path.join(dir, 'index.html');
                        fs.createReadStream(file).pipe(fs.createWriteStream(out));
                    }
                    cbWriteRedirect();
                });
            };
            var defaultIndex = path.join(themeDir, 'assets', 'index.html');
            var stack = new Y.Parallel();
            Y.log('Making default directories: ' + dirs.join(','), 'info', 'builder');
            dirs.forEach(function(d) {
                var dir = path.join(self.options.outdir, d);
                Y.Files.exists(dir, stack.add(function(x) {
                    if (!x) {
                        fs.mkdir(dir, '0777', stack.add(function() {
                            writeRedirect(dir, defaultIndex, stack.add(noop));
                        }));
                    } else {
                        writeRedirect(dir, defaultIndex, stack.add(noop));
                    }
                }));
            });
            stack.done(function() {
                if (cb) {
                    cb();
                }
            });
        },


        _resolveUrl: function(url, opts) {
            if (!url) {
                return null;
            }
            if (url.indexOf('://') >= 0) {
                return url;
            }
            return path.join(opts.meta.projectRoot, url);
        },

        /**
         * Parses `<pre><code>` tags and adds the __prettyprint__ `className` to them
         * @method _parseCode
         * @private
         * @param {HTML} html The HTML to parse
         * @return {HTML} The parsed HTML
         */
        _parseCode: function(html) {
            html = html || '';
            //html = html.replace(/<pre><code>/g, '<pre class="code"><code class="prettyprint">');
            html = html.replace(/<pre><code/g, '<pre class="code prettyprint"><code');
            return html;
        },
        /**
        * Ported from [Selleck](https://github.com/rgrove/selleck), this handles ```'s in fields
        that are not parsed by the **Markdown** parser.
        * @method _inlineCode
        * @private
        * @param {HTML} html The HTML to parse
        * @return {HTML} The parsed HTML
        */
        _inlineCode: function(html) {
            html = html.replace(/\\`/g, '__{{SELLECK_BACKTICK}}__');

            html = html.replace(/`(.+?)`/g, function(match, code) {
                return '<code>' + Y.escapeHTML(code) + '</code>';
            });

            html = html.replace(/__\{\{SELLECK_BACKTICK\}\}__/g, '`');

            return html;
        },


        /**
         * Generate meta informations for render class and interface
         * @method _generateClassInformations
         * @private
         *
         */
        _generateClassInformations: function(data, opts, item) {
            var self = this;
            var e;
            switch (item.itemtype) {
                case 'method':
                    item = this.augmentData(item);
                    item.paramsList = [];

                    if (item.params && item.params.forEach) {
                        item.params.forEach(function(p) {
                            var name = p.name;
                            if (p.optional) {
                                name = '[' + name + ((p.optdefault) ? '=' + p.optdefault : '') + ']';
                            }
                            item.paramsList.push(name);
                        });
                    }
                    item.methodDescription = this._parseCode(item.description);
                    if (item.example && item.example.length) {
                        if (item.example.forEach) {
                            e = '';
                            item.example.forEach(function(v) {
                                e += self._parseCode(self.markdown(v));
                            });
                            item.example = e;
                        } else if (!item.extended_from) {
                            item.example = this._parseCode(this.markdown(item.example));
                        }
                    }
                    item.hasAccessType = item.access;
                    item.hasParams = item.paramsList.length;
                    if (item.paramsList.length) {
                        item.paramsList = item.paramsList.join(', ');
                    } else {
                        item.paramsList = ' ';
                    }
                    item.returnType = ' ';
                    if (item.return) {
                        item.hasReturn = true;
                        item.returnType = item.return.type;
                    }

                    // If this item is provided by a module other
                    // than the module that provided the original
                    // class, add the original module name to the
                    // item's `providedBy` property so we can
                    // indicate the relationship.
                    if ((item.submodule || item.module) !== (data.submodule || data.module)) {
                        item.providedBy = (item.submodule || item.module);
                    }

                    opts.meta.methods.push(item);
                    break;
                case 'enum':
                case 'property':
                    item = this.augmentData(item);
                    //item.propertyDescription = this._parseCode(markdown(item.description || ''));
                    item.propertyDescription = this._parseCode(item.description);
                    if (!item.type) {
                        item.type = 'unknown';
                    }
                    if (item.final === '') {
                        item.final = true;
                    }
                    if (item.example && item.example.length) {
                        if (item.example.forEach) {
                            e = '';
                            item.example.forEach(function(v) {
                                e += self._parseCode(self.markdown(v));
                            });
                            item.example = e;
                        } else {
                            item.example = this._parseCode(this.markdown(item.example));
                        }
                    }

                    // If this item is provided by a module other
                    // than the module that provided the original
                    // class, add the original module name to the
                    // item's `providedBy` property so we can
                    // indicate the relationship.
                    if ((item.submodule || item.module) !== (data.submodule || data.module)) {
                        item.providedBy = (item.submodule || item.module);
                    }

                    opts.meta.properties.push(item);
                    break;

                case 'attribute': // fallthru
                case 'config':
                    item = this.augmentData(item);
                    //item.attrDescription = this._parseCode(markdown(item.description || ''));
                    item.attrDescription = this._parseCode(item.description);

                    if (item.itemtype === 'config') {
                        item.config = true;
                    } else {
                        item.emit = this.options.attributesEmit;
                    }
                    if (item.readonly === '') {
                        item.readonly = true;
                    }

                    if (item.example && item.example.length) {
                        if (item.example.forEach) {
                            e = '';
                            item.example.forEach(function(v) {
                                e += self._parseCode(self.markdown(v));
                            });
                            item.example = e;
                        } else {
                            item.example = this._parseCode(this.markdown(item.example));
                        }
                    }

                    // If this item is provided by a module other
                    // than the module that provided the original
                    // class, add the original module name to the
                    // item's `providedBy` property so we can
                    // indicate the relationship.
                    if ((item.submodule || item.module) !== (data.submodule || data.module)) {
                        item.providedBy = (item.submodule || item.module);
                    }

                    opts.meta.attrs.push(item);
                    break;
                case 'event':
                    item = this.augmentData(item);
                    //item.eventDescription = this._parseCode(markdown(item.description || ''));
                    item.eventDescription = this._parseCode(item.description);

                    if (item.example && item.example.length) {
                        if (item.example.forEach) {
                            e = '';
                            item.example.forEach(function(v) {
                                e += self._parseCode(self.markdown(v));
                            });
                            item.example = e;
                        } else {
                            item.example = this._parseCode(this.markdown(item.example));
                        }
                    }

                    // If this item is provided by a module other
                    // than the module that provided the original
                    // class, add the original module name to the
                    // item's `providedBy` property so we can
                    // indicate the relationship.
                    if ((item.submodule || item.module) !== (data.submodule || data.module)) {
                        item.providedBy = (item.submodule || item.module);
                    }

                    opts.meta.events.push(item);
                    break;
            }
            return opts;
        },
        /**
        * Ported from [Selleck](https://github.com/rgrove/selleck)
        Renders the handlebars templates with the default View class.
        * @method render
        * @param {HTML} source The default template to parse
        * @param {Class} view The default view handler
        * @param {HTML} [layout=null] The HTML from the layout to use.
        * @param {Object} [partials=object] List of partials to include in this template
        * @param {Callback} callback
        * @param {Error} callback.err
        * @param {HTML} callback.html The assembled template markup
        */
        render: function(source, view, layout, partials, callback) {
            var html = [];

            // function buffer(line) {
            //     html.push(line);
            // }

            // Allow callback as third or fourth param.
            if (typeof partials === 'function') {
                callback = partials;
                partials = {};
            } else if (typeof layout === 'function') {
                callback = layout;
                layout = null;
            }
            var parts = Y.merge(partials || {}, {
                layout_content: source
            });
            Y.each(parts, function(partialsSource, name) {
                Y.Handlebars.registerPartial(name, partialsSource);
            });

            if (!TEMPLATE || !this.cacheTemplates) {
                TEMPLATE = Y.Handlebars.compile(layout);
            }


            var _v = {};
            for (var k in view) {
                if (Y.Lang.isFunction(view[k])) {
                    _v[k] = view[k]();
                } else {
                    _v[k] = view[k];
                }
            }
            html = TEMPLATE(_v);
            //html = html.replace(/{{&#x2F;/g, '{{/');


            //html = (Y.Handlebars.compile(html))({});

            html = this._inlineCode(html);
            callback(null, html);
        },
        /**
         * Render the index file
         * @method renderIndex
         * @param {Function} cb The callback fired when complete
         * @param {String} cb.html The HTML to render this view
         * @param {Object} cb.view The View Data
         */
        renderIndex: function(cb) {
            var self = this;

            Y.prepare([DEFAULT_THEME, themeDir], self.getProjectMeta(), function(err, opts) {
                if (err) {
                    Y.log(err, 'error', 'builder');
                    cb(err);
                    return;
                }
                opts.meta.title = self.data.project.name;
                opts.meta.projectRoot = './';
                opts.meta.projectAssets = './assets';
                opts.meta.projectLogo = self._resolveUrl(self.data.project.logo, opts);
                opts = self.populateClasses(opts);
                opts = self.populateInterfaces(opts);
                opts = self.populateElements(opts);
                opts = self.populateModules(opts);
                opts = self.populateNamespaces(opts);

                var view = new Y.DocView(opts.meta);
                self.render('{{>index}}', view, opts.layouts.main, opts.partials, function(renderErr, html) {
                    if (renderErr) {
                        Y.log(renderErr, 'error', 'builder');
                        cb(renderErr);
                        return;
                    }
                    self.files++;
                    cb(html, view);
                });
            });
        },
        /**
         * Generates the index.html file
         * @method writeIndex
         * @param {Callback} cb The callback to execute after it's completed
         * @param {String} cb.html The HTML to write index view
         * @param {Object} cb.view The View Data
         */
        writeIndex: function(cb) {
            var self = this,
                stack = new Y.Parallel();

            Y.log('Preparing index.html', 'info', 'builder');
            self.renderIndex(stack.add(function(html, view) {
                stack.html = html;
                stack.view = view;
                if (self.options.dumpview) {
                    Y.Files.writeFile(path.join(self.options.outdir, 'json', 'index.json'), JSON.stringify(view), stack.add(noop));
                }
                Y.Files.writeFile(path.join(self.options.outdir, 'index.html'), html, stack.add(noop));
            }));

            stack.done(function( /* html, view */ ) {
                Y.log('Writing index.html', 'info', 'builder');
                cb(stack.html, stack.view);
            });
        },
        /**
         * Render a module
         * @method renderModule
         * @param {Function} cb The callback fired when complete
         * @param {String} cb.html The HTML to render this view
         * @param {Object} cb.view The View Data
         */
        renderModule: function(cb, data, layout) {
            var self = this;
            var stack = new Y.Parallel();

            data.displayName = data.name;
            data.name = self.filterFileName(data.name);
            Y.prepare([DEFAULT_THEME, themeDir], self.getProjectMeta(), function(err, opts) {
                if (err) {
                    Y.log(err, 'error', 'builder');
                    cb(err);
                    return;
                }
                opts.meta = Y.merge(opts.meta, data);

                //opts.meta.htmlTitle = v.name + ': ' + self.data.project.name;
                opts.meta.title = self.data.project.name;

                opts.meta.moduleName = data.displayName || data.name;
                opts.meta.moduleDescription = self._parseCode(self.markdown(data.description || ' '));
                opts.meta.file = data.file;
                opts.meta.line = data.line;
                opts.meta = self.addFoundAt(opts.meta);
                opts.meta.projectRoot = '../';
                opts.meta.projectAssets = '../assets';
                opts.meta.projectLogo = self._resolveUrl(self.data.project.logo, opts);
                opts = self.populateClasses(opts);
                opts = self.populateInterfaces(opts);
                opts = self.populateElements(opts);
                opts = self.populateModules(opts);
                opts = self.populateFiles(opts);

                if (data.classes && Object.keys(data.classes).length) {
                    opts.meta.moduleClasses = [];
                    Y.each(Object.keys(data.classes), function(name) {
                        var i = self.data.classes[name];
                        if (i) {
                            opts.meta.moduleClasses.push({
                                name: i.name,
                                displayName: i.name
                            });
                        }
                    });
                    opts.meta.moduleClasses.sort(self.nameSort);
                }
                if (data.elements && Object.keys(data.elements).length) {
                    opts.meta.moduleElements = [];
                    Y.each(Object.keys(data.elements), function(name) {
                        var i = self.data.elements[name];
                        if (i) {
                            opts.meta.moduleElements.push({
                                name: i.name,
                                displayName: i.name
                            });
                        }
                    });
                    opts.meta.moduleElements.sort(self.nameSort);
                }
                if (data.interfaces && Object.keys(data.interfaces).length) {
                    opts.meta.moduleInterfaces = [];
                    Y.each(Object.keys(data.interfaces), function(name) {
                        var i = self.data.interfaces[name];
                        if (i) {
                            opts.meta.moduleInterfaces.push({
                                name: i.name,
                                displayName: i.name
                            });
                        }
                    });
                    opts.meta.moduleInterfaces.sort(self.nameSort);
                }
                if (data.example && data.example.length) {
                    if (data.example.forEach) {
                        var e = '';
                        data.example.forEach(function(v) {
                            e += self._parseCode(self.markdown(v));
                        });
                        data.example = e;
                    } else {
                        data.example = self._parseCode(self.markdown(data.example));
                    }
                    opts.meta.example = data.example;
                }
                if (data.submodules && Object.keys(data.submodules).length) {
                    opts.meta.subModules = [];
                    Y.each(Object.keys(data.submodules), function(name) {
                        var i = self.data.modules[name];
                        if (i) {
                            opts.meta.subModules.push({
                                name: i.name,
                                displayName: i.name,
                                description: i.description
                            });
                        }
                    });
                    opts.meta.subModules.sort(self.nameSort);
                }

                var view = new Y.DocView(opts.meta);
                var mainLayout = opts.layouts[layout];
                self.render('{{>module}}', view, mainLayout, opts.partials, stack.add(function(renderErr, html) {
                    if (renderErr) {
                        Y.log(renderErr, 'error', 'builder');
                        cb(renderErr);
                        return;
                    }
                    self.files++;
                    stack.html = html;
                    stack.view = view;
                }));
            });

            stack.done(function() {
                cb(stack.html, stack.view);
            });
        },
        renderNamespaces: function(cb, data, layout) {
            var self = this;
            var stack = new Y.Parallel();

            data.displayName = data.name;
            data.name = self.filterFileName(data.name);
            Y.prepare([DEFAULT_THEME, themeDir], self.getProjectMeta(), function(err, opts) {
                if (err) {
                    Y.log(err, 'error', 'builder');
                    cb(err);
                    return;
                }
                opts.meta = Y.merge(opts.meta, data);

                opts.meta.title = self.data.project.name;

                opts.meta.file = data.file;
                opts.meta.line = data.line;
                opts.meta = self.addFoundAt(opts.meta);
                opts.meta.projectRoot = '../';
                opts.meta.projectAssets = '../assets';
                opts.meta.projectLogo = self._resolveUrl(self.data.project.logo, opts);

                opts = self.populateClasses(opts);
                opts = self.populateInterfaces(opts);
                opts = self.populateElements(opts);
                opts = self.populateModules(opts);
                opts = self.populateFiles(opts);
                opts = self.populateNamespaces(opts);

                opts.meta.namespaceClasses = data.classes;
                opts.meta.namespaceInterfaces = data.interfaces;
                opts.meta.namespaceSubNamespaces = data.namespaces;
                opts.meta.namespaceProperties = [];

                data.items.forEach(function(item) {
                  if (item.itemtype) {
                    opts.meta.namespaceProperties.push(item);
                  }
                });

                var view = new Y.DocView(opts.meta);
                var mainLayout = opts.layouts[layout];
                self.render('{{>namespaces}}', view, mainLayout, opts.partials, stack.add(function(renderErr, html) {
                    if (renderErr) {
                        Y.log(renderErr, 'error', 'builder');
                        cb(renderErr);
                        return;
                    }
                    self.files++;
                    stack.html = html;
                    stack.view = view;
                }));
            });

            stack.done(function() {
                cb(stack.html, stack.view);
            });
        },
        /**
         * Checks an array of items (class items) to see if an item is in that list
         * @method hasProperty
         * @param {Array} a The Array of items to check
         * @param {Object} b The object to find
         * @return Boolean
         */
        hasProperty: function(a, b) {
            var other = false;
            Y.some(a, function(i, k) {
                if ((i.itemtype === b.itemtype) && (i.name === b.name)) {
                    other = k;
                    return true;
                }
            });
            return other;
        },
        /**
         * Counter for stepping into merges
         * @private
         * @property _mergeCounter
         * @type Number
         */
        _mergeCounter: null,
        _mergeMethods: function(container, info, hasItems, items) {
            var self = this;
            Object.keys(hasItems).forEach(function(name) {
                if (self.data[container][name]) {
                    self.data[container][name].items.forEach(function(v) {
                        if (!v.static) {
                            var q,
                                override = self.hasProperty(items, v);
                            if (override === false) {
                                //This method was extended from the parent class but not over written
                                q = Y.merge({}, v);
                                q.extended_from = name;
                                items.push(q);
                            } else {
                                //This method was extended from the parent and overwritten in this class
                                q = Y.merge({}, v);
                                q[(container === 'classes' ? 'class' : 'interface')] = name;
                                q = self.augmentData(q);
                                q[(container === 'classes' ? 'overwritter' : 'implementer')] = info.name;
                                items[override].overwritten_from = q;
                            }
                        }

                    });
                }
            })
            return items;
        },
        /**
         * Merge superclass data into a child class
         * @method mergeExtends
         * @param {Object} info The item to extend
         * @param {Array} classItems The list of items to merge in
         * @param {Boolean} first Set for the first call
         */
        mergeExtends: function(info, items, first, type) {
            var self = this;
            self._mergeCounter = (first) ? 0 : (self._mergeCounter + 1);

            if (self._mergeCounter === 100) {
                throw ('YUIDoc detected a loop extending class ' + info.name);
            }
            var container = type === 'class' ? 'classes' : 'interfaces';

            if (info && (info.extends || info.uses)) {
                var hasItems = {};
                hasItems[info.extends] = 1;
                if (info.uses) {
                    info.uses.forEach(function(v) {
                        hasItems[v] = 1;
                    });
                }
                items = this._mergeMethods(container, info, hasItems, items);
                if (self.data[container][info.extends]) {
                    if (self.data[container][info.extends].implements) {
                        items = self.mergeImplements(self.data[container][info.extends], items, false);
                    }
                    if (self.data[container][info.extends].extends || self.data[container][info.extends].uses) {
                        //console.error('Stepping down to:', self.data[container][info.extends]);
                        items = self.mergeExtends(self.data[container][info.extends], items, false, type);
                    }
                }
            }
            return items;
        },

        mergeImplements: function(info, items, first) {
            var self = this;
            self._mergeCounter = (first) ? 0 : (self._mergeCounter + 1);

            if (info.implements) {
                info.implements.forEach(function(minterface) {
                    var hasItems = {};
                    hasItems[minterface] = 1;
                    items = self._mergeMethods('interfaces', info, hasItems, items);
                    items = self.mergeExtends(self.data.interfaces[minterface], items, false, 'interface');
                });
            }
            return items;
        },
        /**
         * Render the class file
         * @method renderClass
         * @param {Function} cb The callback fired when complete
         * @param {String} cb.html The HTML to render this view
         * @param {Object} cb.view The View Data
         */
        renderClass: function(cb, data, layout) {
            var self = this;
            var stack = new Y.Parallel();

            Y.prepare([DEFAULT_THEME, themeDir], self.getProjectMeta(), function(err, opts) {
                //console.log(opts);
                if (err) {
                    console.log(err);
                }

                opts.meta = Y.merge(opts.meta, data);

                opts.meta.title = self.data.project.name;
                opts.meta.moduleName = data.name;
                opts.meta.file = data.file;
                opts.meta.line = data.line;
                opts.meta = self.addFoundAt(opts.meta);
                opts.meta.projectRoot = '../';
                opts.meta.projectAssets = '../assets';
                opts.meta.projectLogo = self._resolveUrl(self.data.project.logo, opts);

                opts = self.populateClasses(opts);
                opts = self.populateInterfaces(opts);
                opts = self.populateElements(opts);
                opts = self.populateModules(opts);
                opts = self.populateFiles(opts);
                opts = self.populateNamespaces(opts);

                opts.meta.classDescription = self._parseCode(self.markdown(data.description || ' '));

                opts.meta.methods = [];
                opts.meta.properties = [];
                opts.meta.attrs = [];
                opts.meta.events = [];
                opts.meta.extension_for = null;
                if (data.uses) {
                    opts.meta.uses = data.uses;
                }
                if (data.entension_for && data.extension_for.length) {
                    opts.meta.extension_for = data.extension_for;
                }

                if (data.extends) {
                    opts.meta.extends = data.extends;
                }

                var classItems = [];
                self.data.classes[data.name].items.forEach(function(item) {
                    classItems.push(item);
                });
                classItems = self.mergeImplements(data, classItems, true);
                classItems = self.mergeExtends(data, classItems, true, 'class');

                if (data.is_constructor) {
                    var constructor = Y.mix({}, data);
                    constructor = self.augmentData(constructor);
                    constructor.paramsList = [];
                    if (constructor.params) {
                        constructor.params.forEach(function(p) {
                            var name = p.name;
                            if (p.optional) {
                                name = '[' + name + ((p.optdefault) ? '=' + p.optdefault : '') + ']';
                            }
                            constructor.paramsList.push(name);
                        });
                    }
                    //i.methodDescription = self._parseCode(markdown(i.description));
                    constructor.hasAccessType = constructor.access;
                    constructor.hasParams = constructor.paramsList.length;
                    if (constructor.paramsList.length) {
                        constructor.paramsList = constructor.paramsList.join(', ');
                    } else {
                        constructor.paramsList = ' ';
                    }
                    constructor.returnType = ' ';
                    if (constructor.return) {
                        constructor.hasReturn = true;
                        constructor.returnType = constructor.return.type;
                    }
                    //console.error(i);
                    opts.meta.is_constructor = [constructor];
                    if (constructor.example && constructor.example.length) {
                        if (constructor.example.forEach) {
                            var example = '';
                            constructor.example.forEach(function(v) {
                                example += self._parseCode(self.markdown(v));
                            });
                            constructor.example = example;
                        } else {
                            constructor.example = self._parseCode(self.markdown(constructor.example));
                        }
                    }
                }

                classItems.forEach(function(i) {
                    opts = self._generateClassInformations(data, opts, i);
                });

                if (!self.options.dontsortfields) {
                    opts.meta.attrs.sort(self.nameSort);
                    opts.meta.events.sort(self.nameSort);
                    opts.meta.methods.sort(self.nameSort);
                    opts.meta.properties.sort(self.nameSort);
                }

                if (!opts.meta.methods.length) {
                    delete opts.meta.methods;
                }
                if (!opts.meta.properties.length) {
                    delete opts.meta.properties;
                }
                if (!opts.meta.attrs.length) {
                    delete opts.meta.attrs;
                }
                if (!opts.meta.events.length) {
                    delete opts.meta.events;
                }

                var view = new Y.DocView(opts.meta);
                var mainLayout = opts.layouts[layout];
                self.render('{{>classes}}', view, mainLayout, opts.partials, stack.add(function(renderErr, html) {
                    if (renderErr) {
                        Y.log(renderErr, 'error', 'builder');
                        cb(renderErr);
                        return;
                    }
                    self.files++;
                    stack.html = html;
                    stack.view = view;
                    stack.opts = opts;
                }));
            });

            stack.done(function() {
                cb(stack.html, stack.view, stack.opts);
            });
        },
        /**
         * Render the interface file
         * @method renderInterface
         * @param {Function} cb the callback fired when complete
         * @param {String} cb.html The HTML to render
         * @param {Object} cb.view The View Data
         */
        renderInterface: function(cb, data, layout) {
            var self = this;
            var stack = new Y.Parallel();

            Y.prepare([DEFAULT_THEME, themeDir], self.getProjectMeta(), function(err, opts) {
                //console.log(opts);
                if (err) {
                    console.log(err);
                }
                opts.meta = Y.merge(opts.meta, data);

                opts.meta.title = self.data.project.name;
                opts.meta.moduleName = data.name;
                opts.meta.file = data.file;
                opts.meta.line = data.line;
                opts.meta = self.addFoundAt(opts.meta);
                opts.meta.projectRoot = '../';
                opts.meta.projectAssets = '../assets';
                opts.meta.projectLogo = self._resolveUrl(self.data.project.logo, opts);

                opts = self.populateClasses(opts);
                opts = self.populateInterfaces(opts);
                opts = self.populateElements(opts);
                opts = self.populateModules(opts);
                opts = self.populateFiles(opts);
                opts = self.populateNamespaces(opts);

                opts.meta.interfaceDescription = self._parseCode(self.markdown(data.description || ' '));

                opts.meta.methods = [];
                opts.meta.properties = [];
                opts.meta.attrs = [];
                opts.meta.events = [];
                opts.meta.extension_for = null;
                if (data.uses) {
                    opts.meta.uses = data.uses;
                }
                if (data.entension_for && data.extension_for.length) {
                    opts.meta.extension_for = data.extension_for;
                }

                if (data.extends) {
                    opts.meta.extends = data.extends;
                }

                var interfaceItems = [];
                self.data.interfaces[data.name].items.forEach(function(item) {
                    interfaceItems.push(item);
                });
                interfaceItems = self.mergeExtends(data, interfaceItems, true, 'interface');

                if (data.is_constructor) {
                    var constructor = Y.mix({}, data);
                    constructor = self.augmentData(constructor);
                    constructor.paramsList = [];
                    if (constructor.params) {
                        constructor.params.forEach(function(p) {
                            var name = p.name;
                            if (p.optional) {
                                name = '[' + name + ((p.optdefault) ? '=' + p.optdefault : '') + ']';
                            }
                            constructor.paramsList.push(name);
                        });
                    }
                    //i.methodDescription = self._parseCode(markdown(i.description));
                    constructor.hasAccessType = constructor.access;
                    constructor.hasParams = constructor.paramsList.length;
                    if (constructor.paramsList.length) {
                        constructor.paramsList = constructor.paramsList.join(', ');
                    } else {
                        constructor.paramsList = ' ';
                    }
                    constructor.returnType = ' ';
                    if (constructor.return) {
                        constructor.hasReturn = true;
                        constructor.returnType = constructor.return.type;
                    }
                    //console.error(i);
                    opts.meta.is_constructor = [constructor];
                    if (constructor.example && constructor.example.length) {
                        if (constructor.example.forEach) {
                            var example = '';
                            constructor.example.forEach(function(v) {
                                example += self._parseCode(self.markdown(v));
                            });
                            constructor.example = example;
                        } else {
                            constructor.example = self._parseCode(self.markdown(constructor.example));
                        }
                    }
                }

                interfaceItems.forEach(function(i) {
                    opts = self._generateClassInformations(data, opts, i);
                });

                if (!self.options.dontsortfields) {
                    opts.meta.attrs.sort(self.nameSort);
                    opts.meta.events.sort(self.nameSort);
                    opts.meta.methods.sort(self.nameSort);
                    opts.meta.properties.sort(self.nameSort);
                }

                if (!opts.meta.methods.length) {
                    delete opts.meta.methods;
                }
                if (!opts.meta.properties.length) {
                    delete opts.meta.properties;
                }
                if (!opts.meta.attrs.length) {
                    delete opts.meta.attrs;
                }
                if (!opts.meta.events.length) {
                    delete opts.meta.events;
                }

                var view = new Y.DocView(opts.meta);
                var mainLayout = opts.layouts[layout];
                self.render('{{>interfaces}}', view, mainLayout, opts.partials, stack.add(function(renderErr, html) {
                    if (renderErr) {
                        Y.log(renderErr, 'error', 'builder');
                        cb(renderErr);
                        return;
                    }
                    self.files++;
                    stack.html = html;
                    stack.view = view;
                    stack.opts = opts;
                }));
            });

            stack.done(function() {
                cb(stack.html, stack.view, stack.opts);
            });
        },

        /**
         * Render the element file
         * @method renderElement
         * @param {Function} cb The callback fired when complete
         * @param {String} cb.html The HTML to render this view
         * @param {Object} cb.view The View Data
         */
        renderElement: function(cb, data, layout) {
            var self = this;
            var stack = new Y.Parallel();

            Y.prepare([DEFAULT_THEME, themeDir], self.getProjectMeta(), function(err, opts) {
                if (err) {
                    console.log(err);
                }
                opts.meta = Y.merge(opts.meta, data);

                opts.meta.title = self.data.project.name;
                opts.meta.moduleName = data.name;
                opts.meta.file = data.file;
                opts.meta.line = data.line;
                opts.meta = self.addFoundAt(opts.meta);
                opts.meta.projectRoot = '../';
                opts.meta.projectAssets = '../assets';
                opts.meta.projectLogo = self._resolveUrl(self.data.project.logo, opts);

                opts = self.populateClasses(opts);
                opts = self.populateInterfaces(opts);
                opts = self.populateElements(opts);
                opts = self.populateModules(opts);
                opts = self.populateFiles(opts);
                opts = self.populateNamespaces(opts);

                opts.meta.elementDescription = self._parseCode(self.markdown(data.description || ' '));

                if (data.example && data.example.length) {
                    if (data.example.forEach) {
                        var e = '';
                        data.example.forEach(function(v) {
                            e += self._parseCode(self.markdown(v));
                        });
                        data.example = e;
                    } else {
                        data.example = self._parseCode(self.markdown(data.example));
                    }
                    opts.meta.example = data.example;
                }

                if (!self.options.dontsortfields) {
                    opts.meta.attributes.sort(self.nameSort);
                }

                opts.meta.attributes.forEach(function(a) {
                    a.description = self._parseCode(a.description);
                });

                if (!opts.meta.attributes.length) {
                    delete opts.meta.attributes;
                }

                var view = new Y.DocView(opts.meta);
                var mainLayout = opts.layouts[layout];
                self.render('{{>elements}}', view, mainLayout, opts.partials, stack.add(function(renderErr, html) {
                    if (renderErr) {
                        Y.log(renderErr, 'error', 'builder');
                        cb(renderErr);
                        return;
                    }
                    self.files++;
                    stack.html = html;
                    stack.view = view;
                    stack.opts = opts;
                }));
            });

            stack.done(function() {
                cb(stack.html, stack.view, stack.opts);
            });
        },
        /**
         * Generates the class or element files under "out"/classes/ or "out"/elements/
         * @method writeComponents
         * @param {String} type The component type, "classes" or "elements"
         * @param {Callback} cb The callback to execute after it's completed
         * @param {String} cb.html The HTML to write class view
         * @param {Object} cb.view The View Data
         */
        writeComponents: function(type, cb, layout) {
            layout = layout || 'main';
            var self = this,
                stack = new Y.Parallel();
            stack.html = [];
            stack.view = [];

            var counter = 0;
            Object.keys(self.data[type]).forEach(function(item) {
                if (!self.data[type][item].external) {
                    counter++;
                }
            });
            Y.log('Rendering and writing ' + counter + ' ' + type + ' pages.', 'info', 'builder');
            Y.each(self.data[type], function(item) {
                if (item.external) {
                    return;
                }
                var render = self.typeToRenderFunction[type];
                self[render](stack.add(function(html, view, data) {
                    if (type === 'files' && (!view || !data)) {
                        return;
                    }
                    stack.html.push(html);
                    stack.view.push(view);
                    if (self.options.dumpview) {
                        Y.Files.writeFile(
                            path.join(self.options.outdir, 'json',
                                type + '_' + (type === 'files' ? self.filterFileName(data.name) : item.name) + '.json'),
                            JSON.stringify(view),
                            stack.add(noop));
                    }

                    Y.Files.writeFile(path.join(self.options.outdir, type,
                            (type === 'files' ? self.filterFileName(data.name) : item.name) + '.html'),
                        html, stack.add(noop));
                }), item, layout);
            });
            stack.done(function() {
                Y.log('Finished writing ' + type.replace(/e?s$/, '') + ' files', 'info', 'builder');
                cb(stack.html, stack.view);
            });
        },
        /**
         * Sort method of array of objects with a property called __name__
         * @method nameSort
         * @param {Object} a First object to compare
         * @param {Object} b Second object to compare
         * @return {Number} 1, -1 or 0 for sorting.
         */
        nameSort: function(a, b) {
            if (!a.name || !b.name) {
                return 0;
            }
            var an = a.name.toLowerCase(),
                bn = b.name.toLowerCase(),
                ret = 0;

            if (an < bn) {
                ret = -1;
            }
            if (an > bn) {
                ret = 1;
            }
            return ret;
        },
        /**
         * Render the source file
         * @method renderFile
         * @param {Function} cb The callback fired when complete
         * @param {String} cb.html The HTML to render this view
         * @param {Object} cb.view The View Data
         */
        renderFile: function(cb, data, layout) {
            var self = this;

            Y.prepare([DEFAULT_THEME, themeDir], self.getProjectMeta(), function(err, opts) {
                if (err) {
                    console.log(err);
                }
                if (!data.name) {
                    return;
                }

                opts.meta = Y.merge(opts.meta, data);

                opts.meta.title = self.data.project.name;
                opts.meta.moduleName = data.name;
                opts.meta.projectRoot = '../';
                opts.meta.projectAssets = '../assets';
                opts.meta.projectLogo = self._resolveUrl(self.data.project.logo, opts);

                opts = self.populateClasses(opts);
                opts = self.populateInterfaces(opts);
                opts = self.populateModules(opts);
                opts = self.populateFiles(opts);
                opts = self.populateNamespaces(opts);

                opts.meta.fileName = data.name;
                fs.readFile(opts.meta.fileName, Y.charset, Y.rbind(function(readErr, str, readOpts, readData) {
                    if (readErr) {
                        Y.log(readErr, 'error', 'builder');
                        cb(readErr);
                        return;
                    }

                    if (typeof self.options.tabspace === 'string') {
                        str = str.replace(/\t/g, self.options.tabspace);
                    }

                    readOpts.meta.fileData = str;
                    var view = new Y.DocView(readOpts.meta, 'index');
                    var mainLayout = readOpts.layouts[layout];
                    self.render('{{>files}}', view, mainLayout, readOpts.partials, function(renderErr, html) {
                        if (renderErr) {
                            Y.log(renderErr, 'error', 'builder');
                            cb(renderErr);
                            return;
                        }
                        self.files++;
                        cb(html, view, readData);
                    });

                }, this, opts, data));
            });

        },
        /**
         * Write the API meta data used for the AutoComplete widget
         * @method writeAPIMeta
         * @param {Callback} cb The callback to execute when complete
         * @async
         */
        writeAPIMeta: function(cb) {
            Y.log('Writing API Meta Data', 'info', 'builder');
            var self = this;
            this.renderAPIMeta(function(js) {
                fs.writeFile(path.join(self.options.outdir, 'api.js'), js, Y.charset, cb);
            });
        },
        /**
         * Render the API meta and return the JavaScript
         * @method renderAPIMeta
         * @param {Callback} cb The callback
         * @param {String} cb.apijs The JavaScript code to write API meta data
         * @async
         */
        renderAPIMeta: function(cb) {

            var opts = {
                meta: {}
            };
            opts = this.populateClasses(opts);
            opts = this.populateInterfaces(opts);
            opts = this.populateModules(opts);
            opts = this.populateElements(opts);
            opts = this.populateNamespaces(opts);

            ['elements', 'modules', 'namespaces', 'classes', 'interfaces'].forEach(function(id) {
                opts.meta[id].forEach(function(v, k) {
                    opts.meta[id][k] = v.name;
                    if (v.submodules) {
                        v.submodules.forEach(function(s) {
                            opts.meta[id].push(s.displayName);
                        });
                    }
                });
                opts.meta[id].sort();
            });

            var apijs = 'YUI.add("yuidoc-meta", function(Y) {\n' +
                '   Y.YUIDoc = { meta: ' + JSON.stringify(opts.meta, null, 4) + ' };\n' +
                '});';

            cb(apijs);
        },
        /**
         * Normalizes a file path to a writable filename:
         *
         *    var path = 'lib/file.js';
         *    returns 'lib_file.js';
         *
         * @method filterFileName
         * @param {String} f The filename to normalize
         * @return {String} The filtered file path
         */
        filterFileName: function(f) {
            return f.replace(/[\/\\]/g, '_');
        },
        /**
         * Compiles the templates from the meta-data provided by DocParser
         * @method compile
         * @param {Callback} cb The callback to execute after it's completed
         */
        compile: function(cb) {
            var self = this;
            var starttime = (new Date()).getTime();
            Y.log('Compiling Templates', 'info', 'builder');

            this.mixExternal(function() {
                self.makeDirs(function() {
                    Y.log('Copying Assets', 'info', 'builder');
                    if (!Y.Files.isDirectory(path.join(self.options.outdir, 'assets'))) {
                        fs.mkdirSync(path.join(self.options.outdir, 'assets'), '0777');
                    }
                    Y.Files.copyAssets([
                            path.join(DEFAULT_THEME, 'assets'),
                            path.join(themeDir, 'assets')
                        ],
                        path.join(self.options.outdir, 'assets'),
                        false,
                        function() {
                            var cstack = new Y.Parallel();

                            self.writeComponents('modules', cstack.add(function() {
                                self.writeComponents('namespaces', cstack.add(function() {
                                    if (!self.options.nocode) {
                                        self.writeComponents('files', cstack.add(noop));
                                    }
                                }));
                                self.writeComponents('classes', cstack.add(function() {
                                    if (!self.options.nocode) {
                                        self.writeComponents('files', cstack.add(noop));
                                    }
                                }));
                                self.writeComponents('elements', cstack.add(function() {
                                    if (!self.options.nocode) {
                                        self.writeComponents('files', cstack.add(noop));
                                    }
                                }));
                                self.writeComponents('interfaces', cstack.add(function() {
                                    if (!self.options.nocode) {
                                        self.writeComponents('files', cstack.add(noop));
                                    }
                                }));
                            }));

                            self.writeIndex(cstack.add(noop));
                            self.writeAPIMeta(cstack.add(noop));

                            cstack.done(function() {
                                var endtime = (new Date()).getTime();
                                var timer = ((endtime - starttime) / 1000) + ' seconds';
                                Y.log('Finished writing ' + self.files + ' files in ' + timer, 'info', 'builder');
                                if (cb) {
                                    cb();
                                }
                            });
                        });
                });
            });
        }
    };
});
