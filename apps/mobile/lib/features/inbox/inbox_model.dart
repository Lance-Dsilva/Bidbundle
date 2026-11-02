import 'package:flutter/foundation.dart';

import '../../core/api.dart';
import 'models.dart';

enum InboxStatus { idle, loading, ready, failed }

class InboxModel extends ChangeNotifier {
  InboxModel(this.repository, {required this.onSessionExpired});
  final InboxRepository repository;
  final VoidCallback onSessionExpired;
  String? _owner, _role;
  int _listGeneration = 0, _detailGeneration = 0;
  bool _disposed = false;
  InboxStatus listStatus = InboxStatus.idle, detailStatus = InboxStatus.idle;
  List<InboxThread> items = const [];
  Conversation? detail;
  String? selectedId, listMessage, detailMessage;
  void _emit() {
    if (!_disposed) notifyListeners();
  }

  void setOwner(String? id, String? role) {
    if (_owner == id && _role == role) return;
    clear();
    if (id != null &&
        id.isNotEmpty &&
        {'homeowner', 'hoa_staff', 'provider'}.contains(role)) {
      _owner = id;
      _role = role;
    }
  }

  void clear() {
    _owner = null;
    _role = null;
    _listGeneration++;
    _detailGeneration++;
    items = const [];
    detail = null;
    selectedId = null;
    listMessage = null;
    detailMessage = null;
    listStatus = InboxStatus.idle;
    detailStatus = InboxStatus.idle;
    _emit();
  }

  /// Closing navigation discards pending reads but retains the matched session scope.
  void close() {
    final owner = _owner, role = _role;
    clear();
    _owner = owner;
    _role = role;
  }

  bool _current(String owner, int generation, {bool isDetail = false}) =>
      !_disposed &&
      _owner == owner &&
      generation == (isDetail ? _detailGeneration : _listGeneration);
  Future<void> loadList() async {
    final owner = _owner;
    if (owner == null || _disposed || listStatus == InboxStatus.loading) {
      return;
    }
    final generation = ++_listGeneration;
    closeDetail();
    items = const [];
    listMessage = null;
    listStatus = InboxStatus.loading;
    _emit();
    try {
      final loaded = await repository.loadList(_role!);
      if (!_current(owner, generation)) return;
      items = loaded;
      listStatus = InboxStatus.ready;
      _emit();
    } catch (error) {
      if (!_current(owner, generation)) return;
      if (_expire(error)) return;
      listStatus = InboxStatus.failed;
      listMessage = _message(error);
      _emit();
    }
  }

  Future<void> openDetail(String id) async {
    if (_owner == null || _disposed || !items.any((item) => item.id == id)) {
      return;
    }
    if (selectedId == id && detailStatus == InboxStatus.loading) return;
    closeDetail();
    selectedId = id;
    await refreshDetail();
  }

  Future<void> refreshDetail() async {
    final owner = _owner, id = selectedId;
    if (owner == null ||
        id == null ||
        _disposed ||
        detailStatus == InboxStatus.loading) {
      return;
    }
    final generation = ++_detailGeneration;
    detail = null;
    detailMessage = null;
    detailStatus = InboxStatus.loading;
    _emit();
    try {
      final loaded = await repository.loadDetail(_role!, id);
      if (!_current(owner, generation, isDetail: true) || selectedId != id) {
        return;
      }
      detail = loaded;
      detailStatus = InboxStatus.ready;
      _emit();
    } catch (error) {
      if (!_current(owner, generation, isDetail: true) || selectedId != id) {
        return;
      }
      if (_expire(error)) return;
      detail = null;
      detailStatus = InboxStatus.failed;
      detailMessage = _message(error);
      _emit();
    }
  }

  void closeDetail() {
    _detailGeneration++;
    selectedId = null;
    detail = null;
    detailMessage = null;
    detailStatus = InboxStatus.idle;
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
      return 'We could not load conversations. Please try again.';
    }
    if (error.kind == FailureKind.notFound) {
      return 'This conversation is not available to this account.';
    }
    if (error.kind == FailureKind.invalidResponse) {
      return 'We could not load this conversation response. Some long conversations may be unavailable in this preview.';
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
