#include "MainWindow.h"

#include <QDateTime>
#include <QDir>
#include <QFileInfo>
#include <QSettings>
#include <QStandardPaths>
#include <utility>

void MainWindow::registerClosedForReopen(const QString &path) {
    if (path.isEmpty())
        return;
    const qint64 now = QDateTime::currentMSecsSinceEpoch();
    for (ClosedEntry &e : recentClosed_) {
        if (e.path == path) {
            e.closedMs = now;
            saveRecentClosed();
            return;
        }
    }
    recentClosed_.append({path, now});
    saveRecentClosed();
}

void MainWindow::pruneRecentClosed() {
    const qint64 now = QDateTime::currentMSecsSinceEpoch();
    constexpr qint64 windowMs = 24LL * 60 * 60 * 1000;
    QVector<ClosedEntry> kept;
    kept.reserve(recentClosed_.size());
    for (const ClosedEntry &e : recentClosed_) {
        if (now - e.closedMs <= windowMs)
            kept.append(e);
    }
    if (kept.size() != recentClosed_.size()) {
        recentClosed_ = std::move(kept);
        saveRecentClosed();
    }
}

static QString settingsFilePath() {
    const QString dir = QStandardPaths::writableLocation(QStandardPaths::AppConfigLocation);
    const QString path = dir + QStringLiteral("/notes-app.ini");
    QDir().mkpath(QFileInfo(path).absolutePath());
    return path;
}

void MainWindow::saveRecentClosed() {
    QSettings s(settingsFilePath(), QSettings::IniFormat);
    s.beginWriteArray(QStringLiteral("closed"));
    int i = 0;
    for (const ClosedEntry &e : recentClosed_) {
        s.setArrayIndex(i++);
        s.setValue(QStringLiteral("path"), e.path);
        s.setValue(QStringLiteral("ms"), e.closedMs);
    }
    s.endArray();
}

void MainWindow::loadRecentClosed() {
    QSettings s(settingsFilePath(), QSettings::IniFormat);
    const int n = s.beginReadArray(QStringLiteral("closed"));
    recentClosed_.clear();
    recentClosed_.reserve(n);
    for (int i = 0; i < n; ++i) {
        s.setArrayIndex(i);
        const QString path = s.value(QStringLiteral("path")).toString();
        const qint64 ms = s.value(QStringLiteral("ms")).toLongLong();
        if (!path.isEmpty())
            recentClosed_.append({path, ms});
    }
    s.endArray();
    pruneRecentClosed();
}
