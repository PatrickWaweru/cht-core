import { Injectable, NgZone } from '@angular/core';
import { Store } from '@ngrx/store';
import { toBik_text } from 'bikram-sambat';
import * as moment from 'moment';

import { Xpath } from '@mm-providers/xpath-element-path.provider';
import * as medicXpathExtensions from '../../js/enketo/medic-xpath-extensions';
import EnketoUtils from '../../js/enketo-utils';
import { AddAttachmentService } from '@mm-services/add-attachment.service';
import { DbService } from '@mm-services/db.service';
import { EnketoPrepopulationDataService } from '@mm-services/enketo-prepopulation-data.service';
import { EnketoTranslationService } from '@mm-services/enketo-translation.service';
import { ExtractLineageService } from '@mm-services/extract-lineage.service';
import { FileReaderService } from '@mm-services/file-reader.service';
import { GetReportContentService } from '@mm-services/get-report-content.service';
import { LanguageService } from '@mm-services/language.service';
import { LineageModelGeneratorService } from '@mm-services/lineage-model-generator.service';
import { SearchService } from '@mm-services/search.service';
import { SubmitFormBySmsService } from '@mm-services/submit-form-by-sms.service';
import { TranslateFromService } from '@mm-services/translate-from.service';
import { UserContactService } from '@mm-services/user-contact.service';
import { XmlFormsService } from '@mm-services/xml-forms.service';
import { ZScoreService } from '@mm-services/z-score.service';
import { ServicesActions } from '@mm-actions/services';
import { ContactSummaryService } from '@mm-services/contact-summary.service';
import { TranslateService } from '@mm-services/translate.service';
import { TransitionsService } from '@mm-services/transitions.service';

@Injectable({
  providedIn: 'root'
})
export class EnketoService {
  constructor(
    private store:Store,
    private addAttachmentService:AddAttachmentService,
    private contactSummaryService:ContactSummaryService,
    private dbService:DbService,
    private enketoPrepopulationDataService:EnketoPrepopulationDataService,
    private enketoTranslationService:EnketoTranslationService,
    private extractLineageService:ExtractLineageService,
    private fileReaderService:FileReaderService,
    private getReportContentService:GetReportContentService,
    private languageService:LanguageService,
    private lineageModelGeneratorService:LineageModelGeneratorService,
    private searchService:SearchService,
    private submitFormBySmsService:SubmitFormBySmsService,
    private translateFromService:TranslateFromService,
    private userContactService:UserContactService,
    private xmlFormsService:XmlFormsService,
    private zScoreService:ZScoreService,
    private transitionsService:TransitionsService,
    private translateService:TranslateService,
    private ngZone:NgZone,
  ) {
    this.enketoUtils = new EnketoUtils(
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
      new ServicesActions(this.store),
      window,
      ngZone,
      Xpath,
      this.objUrls
    );
    this.inited = this.init();
  }

  private enketoUtils;
  private readonly objUrls = [];
  private inited:Promise<undefined>;

  private currentForm;
  getCurrentForm() {
    return this.currentForm;
  }

  private init() {
    return this.zScoreService
      .getScoreUtil()
      .then((zscoreUtil) => {
        medicXpathExtensions.init(zscoreUtil, toBik_text, moment);
      })
      .catch((err) => {
        console.error('Error initialising zscore util', err);
      });
  }

  render(selector, form, instanceData, editedListener, valuechangeListener) {
    return this.inited.then(() => {
      return this.ngZone.runOutsideAngular(() => {
        return this.enketoUtils._render(selector, form, instanceData, editedListener, valuechangeListener);
      });
    });
  }

  renderContactForm(formContext: EnketoFormContext) {
    return this.enketoUtils.renderForm(formContext);
  }

  save(formInternalId, form, geoHandle, docId?) {
    return Promise
      .resolve(form.validate())
      .then((valid) => {
        if (!valid) {
          throw new Error('Form is invalid');
        }

        $('form.or').trigger('beforesave');

        return this.ngZone.runOutsideAngular(() => this.enketoUtils._save(formInternalId, form, geoHandle, docId));
      });
  }

  unload(form) {
    $(window).off('.enketo-pagemode');
    if (form) {
      form.resetView();
    }
    // unload blobs
    this.objUrls.forEach((url) => {
      (window.URL || window.webkitURL).revokeObjectURL(url);
    });

    delete window.CHTCore.debugFormModel;
    delete this.currentForm;
    this.objUrls.length = 0;
  }
}

export interface EnketoFormContext {
  selector: string;
  formDoc: string;
  instanceData: Record<string, any>;
  editedListener: () => void;
  valuechangeListener: () => void;
  titleKey?: string;
}
