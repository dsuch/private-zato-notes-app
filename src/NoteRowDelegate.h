#pragma once

#include <QStyledItemDelegate>

class NoteRowDelegate final : public QStyledItemDelegate {
public:
    explicit NoteRowDelegate(QObject *parent = nullptr);

    void paint(QPainter *painter, const QStyleOptionViewItem &option,
               const QModelIndex &index) const override;
    QSize sizeHint(const QStyleOptionViewItem &option, const QModelIndex &index) const override;
};
