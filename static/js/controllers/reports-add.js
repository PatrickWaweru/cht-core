angular.module('inboxControllers').controller('ReportsAddCtrl',
  function (
    $log,
    $q,
    $scope,
    $state,
    $timeout,
    $translate,
    DB,
    Enketo,
    FileReader,
    Snackbar
  ) {

    'ngInject';
    'use strict';

    var getSelected = function() {
      if ($state.params.formId) { // adding
        return $q.resolve({ form: $state.params.formId });
      }
      if ($state.params.reportId) { // editing
        return DB().get($state.params.reportId);
      }
      return $q.reject(new Error('Must have either formId or reportId'));
    };

    $scope.loadingContent = true;
    $scope.contentError = false;
    $scope.saving = false;
    if ($state.params.reportId || $state.params.formId) {
      $scope.setCancelTarget(function() {
        // Note : if no $state.params.reportId, goes to "No report selected".
        $state.go('reports.detail', { id: $state.params.reportId });
      });
    } else {
      $scope.clearCancelTarget();
    }

    var getReportContent = function(doc) {
      // creating a new doc - no content
      if (!doc._id) {
        return $q.resolve();
      }
      // check old style inline form content
      if (doc.content) {
        return $q.resolve(doc.content);
      }
      // check new style attached form content
      return DB().getAttachment(doc._id, Enketo.REPORT_ATTACHMENT_NAME)
        .then(FileReader);
    };

    getSelected()
      .then(function(doc) {
        $log.debug('setting selected', doc);
        $scope.setSelected(doc);
        // TODO: check doc.content as this is where legacy documents stored
        //       their XML. Consider removing this check at some point in the
        //       future.
        return getReportContent(doc).then(function(content) {
          $timeout(function() {
            Enketo.render($('#report-form'), doc.form, content)
              .then(function(form) {
                $scope.form = form;
                $scope.loadingContent = false;
              })
              .catch(function(err) {
                $scope.loadingContent = false;
                $scope.contentError = true;
                $log.error('Error loading form.', err);
              });
          });
        });
      })
      .catch(function(err) {
        $scope.loadingContent = false;
        $log.error('Error setting selected doc', err);
      });

    $scope.saveStatus = {};

    $scope.save = function() {
      if ($scope.saveStatus.saving) {
        $log.debug('Attempted to call reports-add:$scope.save more than once');
        return;
      }

      $scope.saveStatus.saving = true;
      $scope.saveStatus.error = null;
      var doc = $scope.selected[0].report;
      Enketo.save(doc.form, $scope.form, doc._id)
        .then(function(doc) {
          $log.debug('saved report', doc);
          $scope.saveStatus.saving = false;
          $translate($state.params.reportId ? 'report.updated' : 'report.created')
            .then(Snackbar);
          $state.go('reports.detail', { id: doc._id });
        })
        .catch(function(err) {
          $scope.saveStatus.saving = false;
          $log.error('Error submitting form data: ', err);
          $translate('error.report.save').then(function(msg) {
            $scope.saveStatus.error = msg;
          });
        });
    };

    $scope.$on('$destroy', function() {
      if (!$state.includes('reports.add') && !$state.includes('reports.edit')) {
        Enketo.unload($scope.form);
      }
    });
  }
);
