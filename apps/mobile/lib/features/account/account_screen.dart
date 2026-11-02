import '../service_areas/service_areas_screen.dart';

import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../../core/ui/date_label.dart';
import 'account_model.dart';
import '../support/support_screen.dart';

String notificationKindLabel(String kind) => switch (kind) {
  'invitation' => 'Invitation',
  'survey' => 'Survey',
  'request' => 'Request',
  'bid' => 'Bid',
  'award' => 'Award',
  'schedule' => 'Schedule',
  'visit' => 'Visit',
  'review' => 'Review',
  'account' => 'Account',
  'security' => 'Security',
  'reminder' => 'Reminder',
  'booking' => 'Booking',
  'issue' => 'Issue',
  'message' => 'Message',
  _ => 'Notification',
};

class AccountScreen extends StatelessWidget {
  const AccountScreen({super.key, required this.model});
  final AccountModel model;
  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: model,
    builder: (context, _) {
      final profile = model.profile;
      return RefreshIndicator(
        onRefresh: model.loadProfile,
        child: ListView(
          key: const PageStorageKey('account-scroll'),
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(24),
          children: [
            Text('Account', style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 12),
            const Text(
              'Your account details. Editing is not available in this preview.',
            ),
            if (model.profileStatus == AccountStatus.loading)
              const _Loading('Loading account details'),
            if (model.profileStatus == AccountStatus.failed)
              _Error(model.profileMessage!, model.loadProfile),
            if (model.profileStatus == AccountStatus.ready &&
                profile != null) ...[
              const SizedBox(height: 20),
              _Info('Name', profile.name),
              _Info('Email', profile.email),
              _Info(
                'Email verification',
                profile.isVerified ? 'Verified' : 'Not verified',
              ),
              _Info('Account type', switch (profile.role) {
                'homeowner' => 'Homeowner',
                'provider' => 'Provider',
                'hoa_staff' => 'HOA staff',
                _ => 'Other',
              }),
              _Info('Phone', profile.phone),
              _Info('Address', profile.address),
              _Info('Neighborhood on profile', profile.neighborhood),
              _Info(
                'Member since',
                localInstantLabel(context, profile.createdAt),
              ),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: model.openNotifications,
                child: const Text('Recent notifications'),
              ),
              const SizedBox(height: 12),
              if (model.serviceAreasAvailable) ...[
                OutlinedButton(
                  onPressed: model.openServiceAreas,
                  child: const Text('Service areas'),
                ),
                const SizedBox(height: 12),
              ],
              if (model.supportAvailable) ...[
                OutlinedButton(
                  onPressed: model.openSupport,
                  child: const Text('Support requests'),
                ),
                const SizedBox(height: 12),
              ],
              OutlinedButton(
                onPressed: model.loadProfile,
                child: const Text('Refresh account'),
              ),
            ],
          ],
        ),
      );
    },
  );
}

class NotificationsScreen extends StatelessWidget {
  const NotificationsScreen({super.key, required this.model});
  final AccountModel model;
  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: model,
    builder: (context, _) => RefreshIndicator(
      onRefresh: model.loadNotifications,
      child: ListView(
        key: const PageStorageKey('notifications-scroll'),
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(24),
        children: [
          Text(
            'Recent notifications',
            style: Theme.of(context).textTheme.headlineMedium,
          ),
          const SizedBox(height: 12),
          const Text(
            'Up to 30 recent in-app notifications. Opening this screen does not mark them read. Linked destinations are not available in this preview.',
          ),
          if (model.notificationsStatus == AccountStatus.loading)
            const _Loading('Loading notifications'),
          if (model.notificationsStatus == AccountStatus.failed)
            _Error(model.notificationsMessage!, model.loadNotifications),
          if (model.notificationsStatus == AccountStatus.ready) ...[
            if (model.notifications.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Text('No recent notifications.'),
              ),
            ...model.notifications.map(
              (item) => Card(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        notificationKindLabel(item.kind),
                        style: Theme.of(context).textTheme.labelMedium,
                      ),
                      Text(
                        item.readAt == null ? 'Unread' : 'Read',
                        style: Theme.of(context).textTheme.labelLarge,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        item.title,
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                      if (item.body.isNotEmpty) ...[
                        const SizedBox(height: 8),
                        Text(item.body),
                      ],
                      const SizedBox(height: 12),
                      Text(localInstantLabel(context, item.createdAt)),
                      if (item.readAt != null)
                        Text(
                          'Read: ${localInstantLabel(context, item.readAt)}',
                        ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: model.loadNotifications,
              child: const Text('Refresh notifications'),
            ),
          ],
        ],
      ),
    ),
  );
}

class AccountNavigator extends StatelessWidget {
  const AccountNavigator({super.key, required this.model});
  final AccountModel model;
  @override
  Widget build(BuildContext context) {
    Page<void> page({required LocalKey key, required Widget child}) {
      final content = Material(
        color: Theme.of(context).scaffoldBackgroundColor,
        child: child,
      );
      return Theme.of(context).platform == TargetPlatform.iOS
          ? CupertinoPage<void>(key: key, child: content)
          : MaterialPage<void>(key: key, child: content);
    }

    return NavigatorPopHandler<void>(
      enabled:
          model.showingNotifications ||
          model.showingSupport ||
          model.showingServiceAreas,
      onPopWithResult: (_) {
        if (model.showingServiceAreas) {
          model.closeServiceAreas();
          return;
        }
        if (model.showingSupport) {
          if (model.support?.selectedId != null) {
            model.support!.closeDetail();
          } else {
            model.closeSupport();
          }
        } else {
          model.closeNotifications();
        }
      },
      child: Navigator(
        pages: [
          page(
            key: const ValueKey('account'),
            child: AccountScreen(model: model),
          ),
          if (model.showingSupport && model.support != null) ...[
            page(
              key: const ValueKey('support-list'),
              child: SupportScreen(model: model.support!),
            ),
            if (model.support!.selectedId != null)
              page(
                key: ValueKey('support-detail-${model.support!.selectedId}'),
                child: SupportScreen(model: model.support!, detailView: true),
              ),
          ],
          if (model.showingServiceAreas && model.serviceAreas != null)
            page(
              key: const ValueKey('service-areas'),
              child: ServiceAreasScreen(model: model.serviceAreas!),
            ),
          if (model.showingNotifications)
            page(
              key: const ValueKey('notifications'),
              child: NotificationsScreen(model: model),
            ),
        ],
        onDidRemovePage: (removed) {
          if (model.showingServiceAreas &&
              removed.key == const ValueKey('service-areas')) {
            model.closeServiceAreas();
          }
          if (model.showingSupport) {
            if (removed.key == const ValueKey('support-list')) {
              model.closeSupport();
            } else if (model.support?.selectedId != null &&
                removed.key ==
                    ValueKey('support-detail-${model.support!.selectedId}')) {
              model.support!.closeDetail();
            }
          }
          if (model.showingNotifications &&
              removed.key == const ValueKey('notifications')) {
            model.closeNotifications();
          }
        },
      ),
    );
  }
}

class _Info extends StatelessWidget {
  const _Info(this.label, this.value);
  final String label;
  final String? value;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 16),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: Theme.of(context).textTheme.labelLarge),
        Text(value == null || value!.trim().isEmpty ? 'Not provided' : value!),
      ],
    ),
  );
}

class _Loading extends StatelessWidget {
  const _Loading(this.label);
  final String label;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(32),
    child: Center(child: CircularProgressIndicator(semanticsLabel: label)),
  );
}

class _Error extends StatelessWidget {
  const _Error(this.message, this.retry);
  final String message;
  final VoidCallback retry;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 24),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(liveRegion: true, child: Text(message)),
        const SizedBox(height: 16),
        OutlinedButton(onPressed: retry, child: const Text('Retry')),
      ],
    ),
  );
}
