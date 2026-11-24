create policy "owner read portfolio" on storage.objects for select using (bucket_id = 'portfolio-private' and owner_id = auth.uid()::text);
create policy "owner upload portfolio" on storage.objects for insert with check (bucket_id = 'portfolio-private' and owner_id = auth.uid()::text);
create policy "owner delete portfolio" on storage.objects for delete using (bucket_id = 'portfolio-private' and owner_id = auth.uid()::text);
