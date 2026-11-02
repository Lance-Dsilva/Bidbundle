import 'package:flutter/foundation.dart';

import '../../core/api.dart';
import 'models.dart';

enum OpportunitiesStatus { idle, loading, ready, failed }

class OpportunitiesModel extends ChangeNotifier {
  OpportunitiesModel(this.repository, {required this.onSessionExpired});
  final OpportunitiesRepository repository;
  final VoidCallback onSessionExpired;
  String? _owner;
  int _generation = 0;
  bool _disposed = false;
  OpportunitiesStatus status = OpportunitiesStatus.idle;
  OpportunitiesFeed? feed;
  String? message;
  String? expandedId;
  void toggleExpanded(String id) {
    if (status != OpportunitiesStatus.ready ||
        feed?.eligible != true ||
        !feed!.items.any((item) => item.requestId == id)) {
      return;
    }
    expandedId = expandedId == id ? null : id;
    _emit();
  }

  void close() {
    final owner = _owner;
    clear();
    _owner = owner;
  }

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
    _generation++;
    feed = null;
    expandedId = null;
    message = null;
    status = OpportunitiesStatus.idle;
    _emit();
  }

  bool _current(String owner, int generation) =>
      !_disposed && _owner == owner && generation == _generation;
  Future<void> load() async {
    final owner = _owner;
    if (_disposed || owner == null || status == OpportunitiesStatus.loading) {
      return;
    }
    final generation = ++_generation;
    feed = null;
    expandedId = null;
    message = null;
    status = OpportunitiesStatus.loading;
    _emit();
    try {
      final loaded = await repository.load();
      if (!_current(owner, generation)) return;
      feed = loaded;
      status = OpportunitiesStatus.ready;
      _emit();
    } catch (error) {
      if (!_current(owner, generation)) return;
      if (error is ApiFailure && error.kind == FailureKind.unauthenticated) {
        clear();
        onSessionExpired();
        return;
      }
      status = OpportunitiesStatus.failed;
      message = error is ApiFailure && error.kind == FailureKind.invalidResponse
          ? 'We could not load this marketplace response. Large workspaces may be unavailable in this preview.'
          : 'We could not load opportunities. Please try again.';
      _emit();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    super.dispose();
  }
}
