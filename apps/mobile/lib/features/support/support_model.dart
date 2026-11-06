import 'package:flutter/foundation.dart';

import '../../core/api.dart';
import 'models.dart';

enum SupportStatus { idle, loading, ready, failed }

class SupportModel extends ChangeNotifier {
  SupportModel(this.repository, {required this.onSessionExpired});
  final SupportRepository repository;
  final VoidCallback onSessionExpired;
  String? _owner;
  int _listGeneration = 0, _detailGeneration = 0;
  bool _disposed = false;
  SupportStatus listStatus = SupportStatus.idle,
      detailStatus = SupportStatus.idle;
  List<SupportTicketSummary> items = const [];
  SupportTicketDetail? detail;
  String? selectedId, listMessage, detailMessage;
  void _emit() {
    if (!_disposed) notifyListeners();
  }

  void setOwner(String? id) {
    if (_owner == id) return;
    clear();
    if (id != null && id.isNotEmpty) _owner = id;
  }

  void clear() {
    _owner = null;
    _listGeneration++;
    _detailGeneration++;
    items = const [];
    detail = null;
    selectedId = null;
    listMessage = null;
    detailMessage = null;
    listStatus = SupportStatus.idle;
    detailStatus = SupportStatus.idle;
    _emit();
  }

  /// Closing navigation discards pending reads but retains the matched session scope.
  void close() {
    final owner = _owner;
    clear();
    _owner = owner;
  }

  bool _current(String owner, int generation, {bool isDetail = false}) =>
      !_disposed &&
      _owner == owner &&
      generation == (isDetail ? _detailGeneration : _listGeneration);
  Future<void> loadList() async {
    final owner = _owner;
    if (owner == null || _disposed || listStatus == SupportStatus.loading) {
      return;
    }
    final generation = ++_listGeneration;
    closeDetail();
    items = const [];
    listMessage = null;
    listStatus = SupportStatus.loading;
    _emit();
    try {
      final loaded = await repository.loadList();
      if (!_current(owner, generation)) return;
      items = loaded;
      listStatus = SupportStatus.ready;
      _emit();
    } catch (error) {
      if (!_current(owner, generation)) return;
      if (_expire(error)) return;
      listStatus = SupportStatus.failed;
      listMessage = _message(error);
      _emit();
    }
  }

  Future<void> openDetail(String id) async {
    if (_owner == null || _disposed || !items.any((item) => item.id == id)) {
      return;
    }
    if (selectedId == id && detailStatus == SupportStatus.loading) return;
    closeDetail();
    selectedId = id;
    await refreshDetail();
  }

  Future<void> refreshDetail() async {
    final owner = _owner, id = selectedId;
    if (owner == null ||
        id == null ||
        _disposed ||
        detailStatus == SupportStatus.loading) {
      return;
    }
    final generation = ++_detailGeneration;
    detail = null;
    detailMessage = null;
    detailStatus = SupportStatus.loading;
    _emit();
    try {
      final loaded = await repository.loadDetail(id);
      if (!_current(owner, generation, isDetail: true) || selectedId != id) {
        return;
      }
      detail = loaded;
      detailStatus = SupportStatus.ready;
      _emit();
    } catch (error) {
      if (!_current(owner, generation, isDetail: true) || selectedId != id) {
        return;
      }
      if (_expire(error)) return;
      detail = null;
      detailStatus = SupportStatus.failed;
      detailMessage = _message(error);
      _emit();
    }
  }

  void closeDetail() {
    _detailGeneration++;
    selectedId = null;
    detail = null;
    detailMessage = null;
    detailStatus = SupportStatus.idle;
    _emit();
  }

  bool _expire(Object error) {
    if (error is! ApiFailure || error.kind != FailureKind.unauthenticated) {
      return false;
    }
    clear();
    onSessionExpired();
    return true;
  }

  String _message(Object error) {
    if (error is! ApiFailure || error.kind == FailureKind.profileIncomplete) {
      return 'We could not load support information. Please try again.';
    }
    if (error.kind == FailureKind.notFound) {
      return 'This support request is not available to this account.';
    }
    if (error.kind == FailureKind.invalidResponse) {
      return 'We could not load this support response. Some long conversations may be unavailable in this preview.';
    }
    return error.message;
  }

  @override
  void dispose() {
    _disposed = true;
    _listGeneration++;
    _detailGeneration++;
    super.dispose();
  }
}
