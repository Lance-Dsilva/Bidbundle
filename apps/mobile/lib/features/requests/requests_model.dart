import 'package:flutter/foundation.dart';

import '../../core/api.dart';
import 'models.dart';

enum RequestStatus { idle, loading, ready, failed }

class RequestsModel extends ChangeNotifier {
  RequestsModel(this.repository, {required this.onSessionExpired});
  final RequestsRepository repository;
  final VoidCallback onSessionExpired;
  String? _owner;
  int _listGeneration = 0, _detailGeneration = 0;
  bool _disposed = false;
  RequestStatus listStatus = RequestStatus.idle,
      detailStatus = RequestStatus.idle;
  List<RequestSummary> items = const [];
  String? eligibilityMessage, listMessage, detailMessage, selectedId;
  RequestDetail? detail;
  void _emit() {
    if (!_disposed) notifyListeners();
  }

  void setOwner(String? id) {
    if (_owner == id) return;
    clear();
    _owner = id;
  }

  void clear() {
    _owner = null;
    _listGeneration++;
    _detailGeneration++;
    items = const [];
    detail = null;
    selectedId = null;
    eligibilityMessage = null;
    listMessage = null;
    detailMessage = null;
    listStatus = RequestStatus.idle;
    detailStatus = RequestStatus.idle;
    _emit();
  }

  bool _current(String owner, int generation, {bool isDetail = false}) =>
      !_disposed &&
      _owner == owner &&
      generation == (isDetail ? _detailGeneration : _listGeneration);
  Future<void> loadList() async {
    final owner = _owner;
    if (owner == null || _disposed || listStatus == RequestStatus.loading) {
      return;
    }
    final generation = ++_listGeneration;
    closeDetail();
    items = const [];
    eligibilityMessage = null;
    listMessage = null;
    listStatus = RequestStatus.loading;
    _emit();
    try {
      final result = await repository.loadList();
      if (!_current(owner, generation)) return;
      items = result.items;
      eligibilityMessage = result.eligibilityMessage;
      listStatus = RequestStatus.ready;
      _emit();
    } catch (error) {
      if (!_current(owner, generation)) return;
      if (error is ApiFailure && error.kind == FailureKind.unauthenticated) {
        clear();
        onSessionExpired();
        return;
      }
      listStatus = RequestStatus.failed;
      listMessage = error is ApiFailure
          ? error.message
          : 'We could not load your requests. Please try again.';
      _emit();
    }
  }

  Future<void> openDetail(String id) async {
    // Only a supported row from the current account's live list can open here.
    if (_owner == null ||
        _disposed ||
        !items.any((item) => item.id == id && item.context == 'neighborhood')) {
      return;
    }
    if (selectedId == id && detailStatus == RequestStatus.loading) return;
    closeDetail();
    selectedId = id;
    await refreshDetail();
  }

  Future<void> refreshDetail() async {
    final owner = _owner, id = selectedId;
    if (owner == null ||
        id == null ||
        _disposed ||
        detailStatus == RequestStatus.loading) {
      return;
    }
    final generation = ++_detailGeneration;
    detail = null;
    detailMessage = null;
    detailStatus = RequestStatus.loading;
    _emit();
    try {
      final loaded = await repository.loadDetail(id);
      if (!_current(owner, generation, isDetail: true) || selectedId != id) {
        return;
      }
      detail = loaded;
      detailStatus = RequestStatus.ready;
      _emit();
    } catch (error) {
      if (!_current(owner, generation, isDetail: true) || selectedId != id) {
        return;
      }
      if (error is ApiFailure && error.kind == FailureKind.unauthenticated) {
        clear();
        onSessionExpired();
        return;
      }
      detail = null;
      detailStatus = RequestStatus.failed;
      detailMessage = error is ApiFailure
          ? error.message
          : 'We could not load this request. Please try again.';
      _emit();
    }
  }

  void closeDetail() {
    _detailGeneration++;
    selectedId = null;
    detail = null;
    detailMessage = null;
    detailStatus = RequestStatus.idle;
    _emit();
  }

  @override
  void dispose() {
    _disposed = true;
    _listGeneration++;
    _detailGeneration++;
    super.dispose();
  }
}
