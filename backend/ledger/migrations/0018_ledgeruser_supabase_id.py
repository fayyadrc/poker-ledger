from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("ledger", "0017_table_default_buy_in_b"),
    ]

    operations = [
        migrations.AddField(
            model_name="ledgeruser",
            name="supabase_id",
            field=models.CharField(
                blank=True, db_index=True, max_length=64, null=True, unique=True
            ),
        ),
    ]
