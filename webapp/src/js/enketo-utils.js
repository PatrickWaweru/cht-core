const uuid = require('uuid').v4;
const pojo2xml = require('pojo2xml');

const HTML_ATTACHMENT_NAME = 'form.html';
const MODEL_ATTACHMENT_NAME = 'model.xml';

module.exports = class EnketoUtils {
  constructor(
    addAttachmentService,
    contactSummaryService,
    dbService,
    enketoPrepopulationDataService,
    enketoTranslationService,
    extractLineageService,
    fileReaderService,
    getReportContentService,
    languageService,
    lineageModelGeneratorService,
    searchService,
    submitFormBySmsService,
    translateFromService,
    userContactService,
    xmlFormsService,
    transitionsService,
    translateService,
    servicesActions,
    window,
    zoneRunner,
    Xpath,
    objUrls
  ) {
    this.addAttachmentService = addAttachmentService;
    this.contactSummaryService = contactSummaryService;
    this.dbService = dbService;
    this.enketoPrepopulationDataService = enketoPrepopulationDataService;
    this.enketoTranslationService = enketoTranslationService;
    this.extractLineageService = extractLineageService;
    this.fileReaderService = fileReaderService;
    this.getReportContentService = getReportContentService;
    this.languageService = languageService;
    this.lineageModelGeneratorService = lineageModelGeneratorService;
    this.searchService = searchService;
    this.submitFormBySmsService = submitFormBySmsService;
    this.translateFromService = translateFromService;
    this.userContactService = userContactService;
    this.xmlFormsService = xmlFormsService;
    this.transitionsService = transitionsService;
    this.translateService = translateService;
    this.servicesActions = servicesActions;
    this.window = window;
    this.zoneRunner = zoneRunner;
    this.Xpath = Xpath;
    this.objUrls = objUrls;
  }

  // Public methods
  _render(selector, form, instanceData, editedListener, valuechangeListener) {
    return this.getUserContact().then(() => {
      const formContext = {
        selector,
        formDoc: form,
        instanceData,
        editedListener,
        valuechangeListener,
      };
      return this.renderForm(formContext);
    });
  }

  _save(formInternalId, form, geoHandle, docId) {
    const getDocPromise = docId ? this.update(docId) : this.create(formInternalId);

    return Promise
      .all([
        getDocPromise,
        this.getFormXml(formInternalId),
      ])
      .then(([doc, formXml]) => this.xmlToDocs(doc, formXml, form.getDataStr({ irrelevant: false })))
      .then((docs) => this.saveGeo(geoHandle, docs))
      .then((docs) => this.transitionsService.applyTransitions(docs))
      .then((docs) => this.saveDocs(docs))
      .then((docs) => {
        this.servicesActions.setLastChangedDoc(docs[0]);
        // submit by sms _after_ saveDocs so that the main doc's ID is available
        this.submitFormBySmsService.submit(docs[0]);
        return docs;
      });
  }

  // Private methods:
  getUserContact() {
    return this.userContactService
      .get()
      .then((contact) => {
        if (!contact) {
          const err = new Error('Your user does not have an associated contact, or does not have access to the ' +
            'associated contact. Talk to your administrator to correct this.');
          err.translationKey = 'error.loading.form.no_contact';
          throw err;
        }
        return contact;
      });
  }

  getAttachment(id, name) {
    return this.dbService
      .get()
      .getAttachment(id, name)
      .then(blob => this.fileReaderService.utf8(blob));
  }

  transformXml(form) {
    return Promise
      .all([
        this.getAttachment(form._id, HTML_ATTACHMENT_NAME),
        this.getAttachment(form._id, MODEL_ATTACHMENT_NAME)
      ])
      .then(([html, model]) => {
        const $html =   $(html);
        $html.find('[data-i18n]').each((idx, element) => {
          const $element =   $(element);
          $element.text(this.translateService.instant('enketo.' + $element.attr('data-i18n')));
        });

        const hasContactSummary =   $(model).find('> instance[id="contact-summary"]').length === 1;
        return {
          html: $html,
          model: model,
          title: form.title,
          hasContactSummary: hasContactSummary
        };
      });
  }

  replaceJavarosaMediaWithLoaders(formDoc, formHtml) {
    formHtml.find('[data-media-src]').each((idx, element) => {
      const $img =   $(element);
      const lang = $img.attr('lang');
      const active = $img.is('.active') ? 'active' : '';
      $img
        .css('visibility', 'hidden')
        .wrap(() => '<div class="loader ' + active + '" lang="' + lang + '"></div>');
    });
  }

  getContactReports(contact) {
    const subjectIds = [ contact._id ];
    const shortCode = contact.patient_id || contact.place_id;
    if (shortCode) {
      subjectIds.push(shortCode);
    }
    return this.searchService.search('reports', { subjectIds: subjectIds }, { include_docs: true });
  }

  getLineage(contact) {
    return this.lineageModelGeneratorService
      .contact(contact._id)
      .then((model) => model.lineage)
      .catch((err) => {
        if (err.code === 404) {
          // eslint-disable-next-line no-console
          console.warn(`Enketo failed to get lineage of contact '${contact._id}' because document does not exist`, err);
          return [];
        }

        throw err;
      });
  }

  getContactSummary(doc, instanceData) {
    const contact = instanceData && instanceData.contact;
    if (!doc.hasContactSummary || !contact) {
      return Promise.resolve();
    }
    return Promise
      .all([
        this.getContactReports(contact),
        this.getLineage(contact)
      ])
      .then(([reports, lineage]) => {
        return this.contactSummaryService.get(contact, reports, lineage);
      })
      .then((summary) => {
        if (!summary) {
          return;
        }

        try {
          return {
            id: 'contact-summary',
            xmlStr: pojo2xml({ context: summary.context })
          };
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('Error while converting app_summary.contact_summary.context to xml.');
          throw new Error('contact_summary context is misconfigured');
        }
      });
  }

  getEnketoForm(wrapper, doc, instanceData) {
    return Promise
      .all([
        this.enketoPrepopulationDataService.get(doc.model, instanceData),
        this.getContactSummary(doc, instanceData),
        this.languageService.get()
      ])
      .then(([ instanceStr, contactSummary, language ]) => {
        const data = {
          modelStr: doc.model,
          instanceStr: instanceStr
        };
        if (contactSummary) {
          data.external = [ contactSummary ];
        }
        const form = wrapper.find('form')[0];
        return new this.window.EnketoForm(form, data, { language });
      });
  }

  getFormTitle(titleKey, doc) {
    if (titleKey) {
      // using translation key
      return this.translateService.get(titleKey);
    }

    if (doc.title) {
      // title defined in the doc
      return Promise.resolve(this.translateFromService.get(doc.title));
    }
  }

  setFormTitle(wrapper, title) {
    // manually translate the title as enketo-core doesn't have any way to do this
    // https://github.com/enketo/enketo-core/issues/405
    const $title = wrapper.find('#form-title');
    if (title) {
      // overwrite contents
      $title.text(title);
    } else if ($title.text() === 'No Title') {
      // useless enketo default - remove it
      $title.remove();
    } // else the title is hardcoded in the form definition - leave it alone
  }

  handleKeypressOnInputField(e) {
    // Here we capture both CR and TAB characters, and handle field-skipping
    if(!this.window.medicmobile_android || (e.keyCode !== 9 && e.keyCode !== 13)) {
      return;
    }

    const $input =   $(this);

    // stop the keypress from being handled elsewhere
    e.preventDefault();

    const $thisQuestion = $input.closest('.question');

    // If there's another question on the current page, focus on that
    if($thisQuestion.attr('role') !== 'page') {
      const $nextQuestion = $thisQuestion.find(
        '~ .question:not(.disabled):not(.or-appearance-hidden), ~ .repeat-buttons button.repeat:not(:disabled)'
      );
      if($nextQuestion.length) {
        if($nextQuestion[0].tagName !== 'LABEL') {
          // The next question is something complicated, so we can't just
          // focus on it.  Next best thing is to blur the current selection
          // so the on-screen keyboard closes.
          $input.trigger('blur');
        } else {
          // Delay focussing on the next field, so that keybaord close and
          // open events both register.  This should mean that the on-screen
          // keyboard is maintained between fields.
          setTimeout(() => {
            $nextQuestion.first().trigger('focus');
          }, 10);
        }
        return;
      }
    }

    // Trigger the change listener on the current field to update the enketo
    // model
    $input.trigger('change');

    const enketoContainer = $thisQuestion.closest('.enketo');

    // If there's no question on the current page, try to go to change page,
    // or submit the form.
    const next = enketoContainer.find('.btn.next-page:enabled:not(.disabled)');
    if(next.length) {
      next.trigger('click');
    } else {
      enketoContainer.find('.btn.submit').trigger('click');
    }
  }

  setupNavButtons($wrapper, currentIndex) {
    if(!this.currentForm.pages) {
      return;
    }
    const lastIndex = this.currentForm.pages.activePages.length - 1;
    const footer = $wrapper.find('.form-footer');
    footer.removeClass('end');
    footer.find('.previous-page, .next-page').removeClass('disabled');

    if (currentIndex >= lastIndex) {
      footer.addClass('end');
      footer.find('.next-page').addClass('disabled');
    }
    if (currentIndex <= 0) {
      footer.find('.previous-page').addClass('disabled');
    }
  }

  forceRecalculate(form) {
    // Work-around for stale jr:choice-name() references in labels.  ref #3870
    form.calc.update();

    // Force forms to update jr:itext references in output fields that contain
    // calculated values.  ref #4111
    form.output.update();
  }

  overrideNavigationButtons(form, $wrapper) {
    $wrapper
      .find('.btn.next-page')
      .off('.pagemode')
      .on('click.pagemode',() => {

        form.pages
          ._next()
          .then((valid) => {
            if(valid) {
              const currentIndex = form.pages._getCurrentIndex();
              this.window.history.pushState({ enketo_page_number: currentIndex }, '');
              this.setupNavButtons($wrapper, currentIndex);
            }
            this.forceRecalculate(form);
          });
        return false;
      });

    $wrapper
      .find('.btn.previous-page')
      .off('.pagemode')
      .on('click.pagemode', () => {
        this.window.history.back();
        this.setupNavButtons($wrapper, form.pages._getCurrentIndex() - 1);
        this.forceRecalculate(form);
        return false;
      });
  }

  addPopStateHandler(form, $wrapper) {
    $(this.window).on('popstate.enketo-pagemode', (event) => {
      if(event.originalEvent &&
        event.originalEvent.state &&
        typeof event.originalEvent.state.enketo_page_number === 'number' &&
        $wrapper.find('.container').not(':empty')) {

        const targetPage = event.originalEvent.state.enketo_page_number;
        const pages = form.pages;
        const currentIndex = pages._getCurrentIndex();
        if(targetPage > currentIndex) {
          pages._next();
        } else {
          pages._prev();
        }
      }
    });
  }

  renderFromXmls(xmlFormContext) {
    const { doc, instanceData, titleKey, wrapper } = xmlFormContext;

    const formContainer = wrapper.find('.container').first();
    formContainer.html(doc.html.get(0));

    return this
      .getEnketoForm(wrapper, doc, instanceData)
      .then((form) => {
        this.currentForm = form;
        const loadErrors = this.currentForm.init();
        if (loadErrors && loadErrors.length) {
          return Promise.reject(new Error(JSON.stringify(loadErrors)));
        }
      })
      .then(() => this.getFormTitle(titleKey, doc))
      .then((title) => {
        this.setFormTitle(wrapper, title);
        wrapper.show();

        wrapper.find('input').on('keydown', this.handleKeypressOnInputField);

        // handle page turning using browser history
        this.window.history.replaceState({ enketo_page_number: 0 }, '');
        this.overrideNavigationButtons(this.currentForm, wrapper);
        this.addPopStateHandler(this.currentForm, wrapper);
        this.forceRecalculate(this.currentForm);
        this.setupNavButtons(wrapper, 0);
        return this.currentForm;
      });
  }

  replaceMediaLoaders(formContainer, formDoc) {
    formContainer.find('[data-media-src]').each((idx, element) => {
      const elem =   $(element);
      const src = elem.attr('data-media-src');
      this.dbService
        .get()
        .getAttachment(formDoc._id, src)
        .then((blob) => {
          const objUrl = (this.window.URL || this.window.webkitURL).createObjectURL(blob);
          this.objUrls.push(objUrl);
          elem
            .attr('src', objUrl)
            .css('visibility', '')
            .unwrap();
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.error('Error fetching media file', formDoc._id, src, err);
          elem.closest('.loader').hide();
        });
    });
  }

  registerAddrepeatListener($selector, formDoc) {
    $selector.on('addrepeat', (ev) => {
      setTimeout(() => { // timeout to allow enketo to finish first
        this.replaceMediaLoaders(  $(ev.target), formDoc);
      });
    });
  }

  registerEditedListener($selector, listener) {
    if (listener) {
      $selector.on('edited', () => this.zoneRunner.run(() => listener()));
    }
  }

  registerValuechangeListener($selector, listener) {
    if (listener) {
      $selector.on('xforms-value-changed', () => this.zoneRunner.run(() => listener()));
    }
  }

  renderForm(formContext) {
    const {
      editedListener,
      formDoc,
      instanceData,
      selector,
      titleKey,
      valuechangeListener,
    } = formContext;

    const $selector =   $(selector);
    return this
      .transformXml(formDoc)
      .then(doc => {
        this.replaceJavarosaMediaWithLoaders(formDoc, doc.html);
        const xmlFormContext = {
          doc,
          wrapper: $selector,
          instanceData,
          titleKey,
        };
        return this.renderFromXmls(xmlFormContext);
      })
      .then((form) => {
        const formContainer = $selector.find('.container').first();
        this.replaceMediaLoaders(formContainer, formDoc);
        this.registerAddrepeatListener($selector, formDoc);
        this.registerEditedListener($selector, editedListener);
        this.registerValuechangeListener($selector, valuechangeListener);
        this.registerValuechangeListener($selector,
          () => this.setupNavButtons($selector, form.pages._getCurrentIndex()));

        this.window.CHTCore.debugFormModel = () => form.model.getStr();
        return form;
      });
  }

  update(docId) {
    // update an existing doc.  For convenience, get the latest version
    // and then modify the content.  This will avoid most concurrent
    // edits, but is not ideal.
    return this.dbService.get().get(docId).then((doc) => {
      // previously XML was stored in the content property
      // TODO delete this and other "legacy" code support commited against
      //      the same git commit at some point in the future?
      delete doc.content;
      return doc;
    });
  }

  create(formInternalId) {
    return this.getUserContact().then((contact) => {
      return {
        form: formInternalId,
        type: 'data_record',
        content_type: 'xml',
        reported_date: Date.now(),
        contact: this.extractLineageService.extract(contact),
        from: contact && contact.phone
      };
    });
  }

  getFormAttachment(doc) {
    return this.getAttachment(doc._id, this.xmlFormsService.findXFormAttachmentName(doc));
  }

  getFormXml(form) {
    return this.xmlFormsService
      .get(form)
      .then(formDoc => this.getFormAttachment(formDoc));
  }

  xmlToDocs(doc, formXml, record) {
    const recordDoc = $.parseXML(record);
    const $record =   $(  $(recordDoc).children()[0]);
    const repeatPaths = this.enketoTranslationService.getRepeatPaths(formXml);

    const mapOrAssignId = (e, id) => {
      if (!id) {
        const $id =   $(e).children('_id');
        if ($id.length) {
          id = $id.text();
        }
        if (!id) {
          id = uuid();
        }
      }
      e._couchId = id;
    };

    mapOrAssignId($record[0], doc._id || uuid());

    const getId = (xpath) => {
      const xPathResult = recordDoc.evaluate(xpath, recordDoc, null, this.window.XPathResult.ANY_TYPE, null);
      let node = xPathResult.iterateNext();
      while (node) {
        if (node._couchId) {
          return node._couchId;
        }
        node = xPathResult.iterateNext();
      }
    };

    const getRelativePath = (path) => {
      if(repeatPaths) {
        const repeatReference = repeatPaths.find(repeatPath => path.startsWith(repeatPath));
        if (repeatReference) {
          return path.replace(`${repeatReference}/`, '');
        }
      }

      if (path.startsWith('./')) {
        return path.replace('./', '');
      }
    };

    const getClosestPath = (element, $element, path) => {
      const relativePath = getRelativePath(path.trim());
      if (!relativePath) {
        return;
      }

      // assign a unique id for xpath context, since the element can be inside a repeat
      if (!element.id) {
        element.id = uuid();
      }
      const uniqueElementSelector = `${element.nodeName}[@id="${element.id}"]`;

      return `//${uniqueElementSelector}/ancestor-or-self::*/descendant-or-self::${relativePath}`;
    };

    // Chrome 30 doesn't support $xml.outerHTML: #3880
    const getOuterHTML = (xml) => {
      if (xml.outerHTML) {
        return xml.outerHTML;
      }
      return   $('<temproot>').append(  $(xml).clone()).html();
    };

    $record
      .find('[db-doc]')
      .filter((idx, element) => {
        return   $(element).attr('db-doc').toLowerCase() === 'true';
      })
      .each((idx, element) => {
        mapOrAssignId(element);
      });

    $record
      .find('[db-doc-ref]')
      .each((idx, element) => {
        const $element =   $(element);
        const reference = $element.attr('db-doc-ref');
        const path = getClosestPath(element, $element, reference);

        const refId = path && getId(path) || getId(reference);
        $element.text(refId);
      });

    const docsToStore = $record
      .find('[db-doc=true]')
      .map((idx, element) => {
        const docToStore = this.enketoTranslationService.reportRecordToJs(getOuterHTML(element));
        docToStore._id = getId(this.Xpath.getElementXPath(element));
        docToStore.reported_date = Date.now();
        return docToStore;
      })
      .get();

    doc._id = getId('/*');
    doc.hidden_fields = this.enketoTranslationService.getHiddenFieldList(record);

    const attach = (elem, file, type, alreadyEncoded, xpath) => {
      xpath = xpath || this.Xpath.getElementXPath(elem);
      // replace instance root element node name with form internal ID
      const filename = 'user-file' +
        (xpath.startsWith('/' + doc.form) ? xpath : xpath.replace(/^\/[^/]+/, '/' + doc.form));
      this.addAttachmentService.add(doc, filename, file, type, alreadyEncoded);
    };

    $record
      .find('[type=file]')
      .each((idx, element) => {
        const xpath = this.Xpath.getElementXPath(element);
        const $input =   $('input[type=file][name="' + xpath + '"]');
        const file = $input[0].files[0];
        if (file) {
          attach(element, file, file.type, false, xpath);
        }
      });

    $record
      .find('[type=binary]')
      .each((idx, element) => {
        const file =   $(element).text();
        if (file) {
          $(element).text('');
          attach(element, file, 'image/png', true);
        }
      });

    record = getOuterHTML($record[0]);

    this.addAttachmentService.add(doc, this.getReportContentService.REPORT_ATTACHMENT_NAME, record, 'application/xml');

    docsToStore.unshift(doc);

    doc.fields = this.enketoTranslationService.reportRecordToJs(record, formXml);
    return docsToStore;
  }

  saveGeo(geoHandle, docs) {
    if (!geoHandle) {
      return docs;
    }

    return geoHandle()
      .catch(err => err)
      .then(geoData => {
        docs.forEach(doc => {
          doc.geolocation_log = doc.geolocation_log || [];
          doc.geolocation_log.push({
            timestamp: Date.now(),
            recording: geoData
          });
          doc.geolocation = geoData;
        });
        return docs;
      });
  }

  saveDocs(docs) {
    return this.dbService
      .get()
      .bulkDocs(docs)
      .then((results) => {
        results.forEach((result) => {
          if (result.error) {
            // eslint-disable-next-line no-console
            console.error('Error saving report', result);
            throw new Error('Error saving report');
          }
          const idx = docs.findIndex(doc => doc._id === result.id);
          docs[idx] = Object.assign({ }, docs[idx]);
          docs[idx]._rev = result.rev;
        });
        return docs;
      });
  }
};
