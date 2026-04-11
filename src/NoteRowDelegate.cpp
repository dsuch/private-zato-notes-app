#include "NoteRowDelegate.h"

#include <QListWidget>
#include <QPainter>
#include <QStyleOptionViewItem>

NoteRowDelegate::NoteRowDelegate(QObject *parent) : QStyledItemDelegate(parent) {}

void NoteRowDelegate::paint(QPainter *painter, const QStyleOptionViewItem &option,
                            const QModelIndex &index) const {
    QStyleOptionViewItem opt = option;
    initStyleOption(&opt, index);
    const QString full = index.data(Qt::DisplayRole).toString();
    const int avail = qMax(4, opt.rect.width() - 10);
    opt.text = opt.fontMetrics.elidedText(full, Qt::ElideRight, avail);
    opt.features.setFlag(QStyleOptionViewItem::WrapText, false);
    opt.displayAlignment = Qt::AlignVCenter | Qt::AlignLeft;
    QStyledItemDelegate::paint(painter, opt, index);
}

QSize NoteRowDelegate::sizeHint(const QStyleOptionViewItem &option, const QModelIndex &index) const {
    Q_UNUSED(index);
    int w = 160;
    if (const auto *lw = qobject_cast<const QListWidget *>(option.widget))
        w = qMax(40, lw->viewport()->width());
    return QSize(w, 28);
}
